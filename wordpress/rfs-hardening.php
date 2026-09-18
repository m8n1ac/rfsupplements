<?php
/**
 * Plugin Name: RF Supplements Hardening
 * Description: Closes unauthenticated user enumeration and stops the site advertising its WordPress version.
 * Version:     1.0.0
 * Author:      CoreShift Digital
 *
 * Installed at wp-content/mu-plugins/rfs-hardening.php.
 *
 * Why this exists: https://rfsupplements.com/wp-json/wp/v2/users returned the
 * administrator accounts — name and login slug — to anyone who asked, and
 * wp-login.php has no rate limiting. Together that is a ready-made
 * credential-stuffing target, on a store that has already seen card testing.
 *
 * Deliberately narrow. It does not touch WooCommerce, the theme, or any
 * existing plugin, and it changes nothing for authenticated staff.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * The users endpoint stays available to anyone who is allowed to list users —
 * the block editor and several plugins need it — and is refused for everyone
 * else. `list_users` is the same capability wp-admin uses for the Users screen.
 */
add_filter(
	'rest_authentication_errors',
	function ( $result ) {
		if ( ! empty( $result ) ) {
			return $result;
		}

		$route = isset( $GLOBALS['wp']->query_vars['rest_route'] )
			? (string) $GLOBALS['wp']->query_vars['rest_route']
			: '';

		if ( '' === $route || 0 !== strpos( $route, '/wp/v2/users' ) ) {
			return $result;
		}

		if ( current_user_can( 'list_users' ) ) {
			return $result;
		}

		return new WP_Error(
			'rest_user_cannot_view',
			__( 'Authentication required.' ),
			array( 'status' => rest_authorization_required_code() )
		);
	},
	20
);

/**
 * ?author=1 redirects to /author/<slug>/, which leaks the same login names the
 * REST route did. Front-end author queries are not used by this store.
 */
add_action(
	'parse_request',
	function ( $query ) {
		if ( is_admin() || empty( $query->query_vars['author'] ) ) {
			return;
		}
		if ( ! is_user_logged_in() ) {
			wp_safe_redirect( home_url( '/' ), 301 );
			exit;
		}
	}
);

// Stop announcing the exact WordPress version to anyone reading the page source
// or a feed. It does not stop a determined fingerprint, but it removes the free
// hint that pairs a known CVE with this site.
remove_action( 'wp_head', 'wp_generator' );
add_filter( 'the_generator', '__return_empty_string' );
