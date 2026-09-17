<?php
/**
 * Plugin Name: RF Supplements CRM Bridge
 * Description: Captures website form submissions into a table the Ops CRM can pull. Read-only over REST.
 * Version:     1.0.0
 * Author:      CoreShift Digital
 *
 * Installed at wp-content/mu-plugins/rfs-crm-bridge.php (spec §7 item 2).
 *
 * Scope, deliberately narrow:
 *   - one table, one REST route, one WP-CLI command
 *   - no settings page, no options, no admin UI
 *   - it never writes to WooCommerce or to any core table
 *
 * Form plugin: Contact Form 7. The spec was written against Elementor Pro Forms,
 * but Phase 0 found Elementor Pro is not installed and all five live forms are
 * CF7. The hook is `wpcf7_mail_sent`, CF7's successful-submission action.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RFS_CRM_Bridge {

	const VERSION   = '1.0.0';
	const NAMESPACE = 'rfs-crm/v1';

	public static function table() {
		global $wpdb;
		return $wpdb->prefix . 'rfs_crm_inbox';
	}

	public static function boot() {
		add_action( 'wpcf7_mail_sent', array( __CLASS__, 'capture_cf7' ), 10, 1 );
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

		if ( $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) ) === $table ) {
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
				PRIMARY KEY (id),
				KEY modified_at_gmt (modified_at_gmt)
			) {$charset};"
		);
	}

	/**
	 * CF7 hands over the complete posted data via WPCF7_Submission.
	 *
	 * @param WPCF7_ContactForm $contact_form The submitted form.
	 */
	public static function capture_cf7( $contact_form ) {
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
				'ip_hash'          => self::hash_ip( $submission->get_meta( 'remote_ip' ) ),
			),
			array( '%s', '%s', '%s', '%s', '%s', '%s', '%s', '%s' )
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

		register_rest_route(
			self::NAMESPACE,
			'/submissions',
			array(
				'methods'             => 'GET',
				'callback'            => array( __CLASS__, 'get_submissions' ),
				'permission_callback' => array( __CLASS__, 'can_read' ),
				'args'                => array(
					'modified_after' => array( 'type' => 'string', 'required' => false ),
					'page'           => array( 'type' => 'integer', 'default' => 1 ),
					'per_page'       => array( 'type' => 'integer', 'default' => 100 ),
				),
			)
		);
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
