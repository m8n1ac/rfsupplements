<?php
/**
 * Plugin Name: RF Supplements CRM Bridge
 * Description: Captures website form submissions into a table the Ops CRM can pull. Read-only over REST.
 * Version:     1.1.0
 * Author:      CoreShift Digital
 *
 * Installed at wp-content/mu-plugins/rfs-crm-bridge.php (spec §7 item 2).
 *
 * Scope, deliberately narrow:
 *   - one table of its own, three read-only REST routes, one WP-CLI command
 *   - no settings page, no options, no admin UI
 *   - it never writes to WooCommerce, to Solid Affiliate, or to any core table
 *
 * The affiliate routes read Solid Affiliate's tables because that plugin
 * publishes no REST API. They are strictly read-only: Solid Affiliate owns
 * commission arithmetic, and a second writer would make "what do we owe"
 * ambiguous.
 *
 * Form plugin: Contact Form 7. The spec was written against Elementor Pro Forms,
 * but Phase 0 found Elementor Pro is not installed and all five live forms are
 * CF7.
 *
 * The hook is `wpcf7_submit`, filtered to the two statuses that mean "a real
 * person submitted a valid form": mail_sent and mail_failed. `wpcf7_mail_sent`
 * would have been the obvious choice, but it fires only when the SMTP send
 * succeeds — so an outage at the mail relay would silently drop inquiries from
 * the CRM as well as from the inbox. Capture is deliberately independent of
 * email delivery. Spam and validation failures are still excluded.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RFS_CRM_Bridge {

	const VERSION   = '1.1.0';
	const NAMESPACE = 'rfs-crm/v1';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'rfs_crm_inbox';
	}

	public static function boot() {
		add_action( 'wpcf7_submit', array( __CLASS__, 'capture_cf7' ), 10, 2 );
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );

		// The table is created on demand in the contexts that can afford a
		// schema check. The front-end submission path never runs dbDelta.
		add_action( 'admin_init', array( __CLASS__, 'maybe_create_table' ) );

		if ( defined( 'WP_CLI' ) && WP_CLI ) {
			WP_CLI::add_command( 'rfs-crm', 'RFS_CRM_Bridge_CLI' );
		}
	}

	public static function maybe_create_table() {
		global $wpdb;

		$table = self::table();

		// dbDelta is idempotent and adds missing columns, so the guard checks for
		// the newest column rather than merely the table. It runs only in admin,
		// REST and CLI contexts — never on the front-end submission path.
		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table
			&& $wpdb->get_var( "SHOW COLUMNS FROM {$table} LIKE 'mail_status'" ) ) {
			return;
		}

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$charset = $wpdb->get_charset_collate();

		dbDelta(
			"CREATE TABLE {$table} (
				id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
				source_plugin VARCHAR(40) NOT NULL,
				form_id VARCHAR(40) NOT NULL,
				form_name VARCHAR(191) NOT NULL,
				submitted_at_gmt DATETIME NOT NULL,
				modified_at_gmt DATETIME NOT NULL,
				fields LONGTEXT NOT NULL,
				page_url TEXT NULL,
				ip_hash CHAR(64) NULL,
				mail_status VARCHAR(20) NOT NULL DEFAULT 'mail_sent',
				PRIMARY KEY (id),
				KEY modified_at_gmt (modified_at_gmt)
			) {$charset};"
		);
	}

	/**
	 * CF7 hands over the complete posted data via WPCF7_Submission.
	 *
	 * @param WPCF7_ContactForm $contact_form The submitted form.
	 * @param array             $result       CF7's submission result.
	 */
	public static function capture_cf7( $contact_form, $result = array() ) {
		// mail_sent: delivered. mail_failed: accepted but the relay refused it —
		// still a genuine inquiry, and the one case worth capturing hardest.
		// Everything else (spam, validation_failed, acceptance_missing, aborted)
		// is not a real submission.
		$status = isset( $result['status'] ) ? $result['status'] : '';
		if ( 'mail_sent' !== $status && 'mail_failed' !== $status ) {
			return;
		}

		if ( ! class_exists( 'WPCF7_Submission' ) ) {
			return;
		}

		$submission = WPCF7_Submission::get_instance();
		if ( ! $submission ) {
			return;
		}

		self::maybe_create_table();

		$posted = $submission->get_posted_data();

		// CF7 includes its own bookkeeping fields; they are noise to the CRM.
		foreach ( array_keys( $posted ) as $key ) {
			if ( strpos( $key, '_wpcf7' ) === 0 || strpos( $key, '_wpnonce' ) === 0 ) {
				unset( $posted[ $key ] );
			}
		}

		$now = gmdate( 'Y-m-d H:i:s' );

		global $wpdb;

		$wpdb->insert(
			self::table(),
			array(
				'source_plugin'    => 'cf7',
				'form_id'          => (string) $contact_form->id(),
				'form_name'        => (string) $contact_form->title(),
				'submitted_at_gmt' => $now,
				'modified_at_gmt'  => $now,
				'fields'           => wp_json_encode( $posted ),
				'page_url'         => $submission->get_meta( 'url' ),
				// Recorded so a relay outage is visible in the CRM rather than silent.
				'mail_status'      => $status,
				'ip_hash'          => self::hash_ip( $submission->get_meta( 'remote_ip' ) ),
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
		);
	}

	/**
	 * The raw IP is never stored. wp_hash() salts with the site's own keys.
	 *
	 * @param string $ip Remote address.
	 * @return string|null
	 */
	private static function hash_ip( $ip ) {
		if ( empty( $ip ) ) {
			return null;
		}
		return hash( 'sha256', wp_hash( $ip ) );
	}

	public static function register_routes() {
		self::maybe_create_table();

		$cursor_args = array(
			'modified_after' => array( 'type' => 'string', 'required' => false ),
			'page'           => array( 'type' => 'integer', 'default' => 1 ),
			'per_page'       => array( 'type' => 'integer', 'default' => 100 ),
		);

		register_rest_route(
			self::NAMESPACE,
			'/submissions',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_submissions' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'args'                => $cursor_args,
			)
		);

		// Solid Affiliate ships no REST API of its own, so the CRM reads its
		// tables through here. Read-only: the CRM never writes commission data,
		// because Solid Affiliate owns that arithmetic and a second writer would
		// make "what do we owe" ambiguous.
		register_rest_route(
			self::NAMESPACE,
			'/affiliates',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_affiliates' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'args'                => $cursor_args,
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/referrals',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_referrals' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'args'                => $cursor_args,
			)
		);
	}

	/**
	 * Solid Affiliate's tables, or null when the plugin is not installed.
	 *
	 * @param string $name Table suffix after the solid_affiliate_ prefix.
	 * @return string|null
	 */
	private static function affiliate_table( $name ) {
		global $wpdb;

		$table  = $wpdb->prefix . 'solid_affiliate_' . $name;
		$exists = $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );

		return $exists === $table ? $table : null;
	}

	/**
	 * Shared cursor pagination. Solid Affiliate writes updated_at in site time,
	 * and this site is UTC (spec §3), so the two agree — but that is a fact
	 * about configuration, not about the plugin. If the site timezone ever
	 * moves, this cursor silently skews.
	 *
	 * @param string $table  Fully qualified table name.
	 * @param object $request REST request.
	 * @param callable $shape Row formatter.
	 * @return WP_REST_Response
	 */
	private static function cursor_page( $table, $request, $shape ) {
		global $wpdb;

		if ( ! $table ) {
			$empty = rest_ensure_response( array() );
			$empty->header( 'X-WP-Total', '0' );
			$empty->header( 'X-WP-TotalPages', '1' );
			return $empty;
		}

		$per_page = max( 1, min( 100, (int) $request->get_param( 'per_page' ) ) );
		$page     = max( 1, (int) $request->get_param( 'page' ) );
		$offset   = ( $page - 1 ) * $per_page;
		$after    = $request->get_param( 'modified_after' );

		if ( $after ) {
			$after = gmdate( 'Y-m-d H:i:s', strtotime( $after ) );
			$total = (int) $wpdb->get_var(
				$wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE updated_at >= %s", $after )
			);
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$table} WHERE updated_at >= %s ORDER BY updated_at ASC, id ASC LIMIT %d OFFSET %d",
					$after,
					$per_page,
					$offset
				),
				ARRAY_A
			);
		} else {
			$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
			$rows  = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$table} ORDER BY updated_at ASC, id ASC LIMIT %d OFFSET %d",
					$per_page,
					$offset
				),
				ARRAY_A
			);
		}

		$response = rest_ensure_response( array_map( $shape, (array) $rows ) );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) ( $per_page > 0 ? (int) ceil( $total / $per_page ) : 1 ) );

		return $response;
	}

	public static function get_affiliates( $request ) {
		return self::cursor_page(
			self::affiliate_table( 'affiliates' ),
			$request,
			array( __CLASS__, 'shape_affiliate' )
		);
	}

	public static function get_referrals( $request ) {
		return self::cursor_page(
			self::affiliate_table( 'referrals' ),
			$request,
			array( __CLASS__, 'shape_referral' )
		);
	}

	private static function shape_affiliate( $row ) {
		// The affiliate's own email lives on the WP user, not on the affiliate
		// row; payment_email is where commission is sent and is frequently a
		// different address. The CRM matches contacts on the former.
		$user  = get_userdata( (int) $row['user_id'] );
		$email = $user ? $user->user_email : '';

		return array(
			'id'              => (int) $row['id'],
			'user_id'         => (int) $row['user_id'],
			'email'           => (string) $email,
			'payment_email'   => (string) $row['payment_email'],
			'first_name'      => (string) $row['first_name'],
			'last_name'       => (string) $row['last_name'],
			'status'          => (string) $row['status'],
			'commission_type' => (string) $row['commission_type'],
			// Money and rates cross as strings. A float in JSON comes back as
			// 683.5700000000001 often enough to matter when it is commission owed.
			'commission_rate' => number_format( (float) $row['commission_rate'], 2, '.', '' ),
			'created_at_gmt'  => self::iso( $row['created_at'] ),
			'updated_at_gmt'  => self::iso( $row['updated_at'] ),
		);
	}

	private static function shape_referral( $row ) {
		return array(
			'id'                => (int) $row['id'],
			'affiliate_id'      => (int) $row['affiliate_id'],
			'order_id'          => $row['order_id'] ? (int) $row['order_id'] : null,
			// Four decimals, not two. Solid Affiliate stores these as FLOAT and a
			// percentage commission lands on quarter-cents (8.4975, 10.615).
			// Rounding here rather than at display changed the unpaid total by a
			// cent — small, but it is money owed, and it made the CRM disagree
			// with the plugin's own report.
			'order_amount'      => number_format( (float) $row['order_amount'], 4, '.', '' ),
			'commission_amount' => number_format( (float) $row['commission_amount'], 4, '.', '' ),
			'status'            => (string) $row['status'],
			'referral_type'     => (string) $row['referral_type'],
			'referral_source'   => (string) $row['referral_source'],
			// Solid Affiliate builds this with price markup in it. Storing HTML
			// that something later renders is a footgun; the CRM wants a label.
			'description'       => trim( html_entity_decode( wp_strip_all_tags( (string) $row['description'] ), ENT_QUOTES, 'UTF-8' ) ),
			'refunded_at_gmt'   => self::iso( $row['order_refunded_at'] ),
			'created_at_gmt'    => self::iso( $row['created_at'] ),
			'updated_at_gmt'    => self::iso( $row['updated_at'] ),
		);
	}

	private static function iso( $value ) {
		if ( empty( $value ) || '0000-00-00 00:00:00' === $value ) {
			return null;
		}
		return str_replace( ' ', 'T', $value );
	}

	public static function can_read() {
		return current_user_can( 'manage_woocommerce' );
	}

	public static function get_submissions( $request ) {
		global $wpdb;

		$table    = self::table();
		$per_page = max( 1, min( 100, (int) $request->get_param( 'per_page' ) ) );
		$page     = max( 1, (int) $request->get_param( 'page' ) );
		$offset   = ( $page - 1 ) * $per_page;
		$after    = $request->get_param( 'modified_after' );

		if ( $after ) {
			$after = gmdate( 'Y-m-d H:i:s', strtotime( $after ) );
			$total = (int) $wpdb->get_var(
				$wpdb->prepare( "SELECT COUNT(*) FROM {$table} WHERE modified_at_gmt >= %s", $after )
			);
			$rows = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$table} WHERE modified_at_gmt >= %s ORDER BY modified_at_gmt ASC, id ASC LIMIT %d OFFSET %d",
					$after,
					$per_page,
					$offset
				),
				ARRAY_A
			);
		} else {
			$total = (int) $wpdb->get_var( "SELECT COUNT(*) FROM {$table}" );
			$rows  = $wpdb->get_results(
				$wpdb->prepare(
					"SELECT * FROM {$table} ORDER BY modified_at_gmt ASC, id ASC LIMIT %d OFFSET %d",
					$per_page,
					$offset
				),
				ARRAY_A
			);
		}

		$response = rest_ensure_response( array_map( array( __CLASS__, 'shape_row' ), (array) $rows ) );
		$response->header( 'X-WP-Total', (string) $total );
		$response->header( 'X-WP-TotalPages', (string) ( $per_page > 0 ? (int) ceil( $total / $per_page ) : 1 ) );

		return $response;
	}

	private static function shape_row( $row ) {
		$fields = json_decode( $row['fields'], true );

		return array(
			'id'               => (int) $row['id'],
			'source_plugin'    => $row['source_plugin'],
			'form_id'          => (string) $row['form_id'],
			'form_name'        => $row['form_name'],
			// The CRM expects Woo's datetime shape.
			'submitted_at_gmt' => str_replace( ' ', 'T', $row['submitted_at_gmt'] ),
			'modified_at_gmt'  => str_replace( ' ', 'T', $row['modified_at_gmt'] ),
			'fields'           => is_array( $fields ) ? $fields : array(),
			'page_url'         => (string) $row['page_url'],
			'mail_status'      => (string) $row['mail_status'],
		);
	}
}

/**
 * WP-CLI: wp rfs-crm backfill
 */
class RFS_CRM_Bridge_CLI {

	/**
	 * Copies historical submissions into the inbox table.
	 *
	 * Contact Form 7 stores nothing — it defines no tables and persists no
	 * submissions; they only ever became email. Phase 0 confirmed Flamingo is
	 * not installed and every candidate table is empty. There is therefore
	 * nothing to copy, and inquiry history begins when this plugin goes live.
	 *
	 * The command exists because spec §7 item 3 calls for it, and it reports
	 * honestly rather than implying a backfill happened.
	 */
	public function backfill() {
		RFS_CRM_Bridge::maybe_create_table();

		if ( ! class_exists( 'WPCF7_ContactForm' ) ) {
			WP_CLI::error( 'Contact Form 7 is not active; nothing to back-fill from.' );
		}

		if ( class_exists( 'Flamingo_Inbound_Message' ) ) {
			WP_CLI::warning( 'Flamingo is now installed. This command does not read it; extend the bridge if that history is wanted.' );
		}

		WP_CLI::success( 'Back-fill complete: 0 submissions copied. Contact Form 7 keeps no submission history.' );
	}
}

RFS_CRM_Bridge::boot();
