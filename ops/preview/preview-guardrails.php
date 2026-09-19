<?php
/**
 * Plugin Name: Preview Guardrails
 * Description: Hard safety rails for preview.rfsupplements.com. Blocks outbound mail, payments, label purchases and indexing.
 * Version:     1.0.0
 * Author:      CoreShift Digital
 *
 * This is a copy of a live store. Left alone it would be a second, fully armed
 * instance of the business: able to charge real cards through the production
 * Authorize.Net credentials, email real customers through the store's Gmail
 * relay, and buy real shipping labels on the live carrier accounts.
 *
 * These rails are enforced in code rather than in settings, because a setting
 * can be flipped back by anyone clicking around in wp-admin — which is exactly
 * what this site exists for. An mu-plugin cannot be deactivated from the admin.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/* -------------------------------------------------------------------------
 * 1. No outbound mail, ever.
 *
 * Short-circuits wp_mail() before it reaches the SMTP relay, so no order
 * notification, password reset or marketing mail can reach a real customer.
 * ---------------------------------------------------------------------- */
add_filter(
	'pre_wp_mail',
	function () {
		return true; // Report success to the caller; send nothing.
	},
	PHP_INT_MAX
);

/* -------------------------------------------------------------------------
 * 2. No payment gateways.
 *
 * Removes every gateway from WooCommerce's available list, so checkout cannot
 * reach a processor even if a gateway is re-enabled in settings.
 * ---------------------------------------------------------------------- */
add_filter( 'woocommerce_available_payment_gateways', '__return_empty_array', PHP_INT_MAX );

/* -------------------------------------------------------------------------
 * 3. No label purchases or fulfilment callbacks.
 *
 * The carrier integrations hold live accounts. Nothing here should be able to
 * spend money or tell a carrier to ship.
 * ---------------------------------------------------------------------- */
add_filter( 'pre_http_request', function ( $preempt, $args, $url ) {
	$blocked = array(
		'api.shippo.com',
		'ssapi.shipstation.com',
		'api.woocommerce.com/shipping',
		'apitest.authorize.net',
		'api.authorize.net',
	);

	foreach ( $blocked as $needle ) {
		if ( false !== stripos( (string) $url, $needle ) ) {
			return new WP_Error(
				'preview_outbound_blocked',
				'Blocked on the preview site: this would have called a live account.'
			);
		}
	}

	return $preempt;
}, PHP_INT_MAX, 3 );

/* -------------------------------------------------------------------------
 * 4. Never indexed.
 * ---------------------------------------------------------------------- */
add_filter( 'pre_option_blog_public', '__return_zero' );
add_action( 'wp_head', function () {
	echo '<meta name="robots" content="noindex, nofollow, noarchive" />' . "\n";
}, 1 );

/* -------------------------------------------------------------------------
 * 5. Say plainly where you are.
 *
 * The whole point of this site is that it looks exactly like production. That
 * is also how someone edits the wrong one.
 * ---------------------------------------------------------------------- */
add_action( 'admin_bar_menu', function ( $bar ) {
	$bar->add_node( array(
		'id'    => 'preview-banner',
		'title' => '⚠ PREVIEW SITE — changes here do not affect the live store',
		'href'  => false,
		'meta'  => array( 'class' => 'preview-banner-node' ),
	) );
}, 5 );

add_action( 'admin_head', function () {
	echo '<style>
		#wpadminbar .preview-banner-node > .ab-item { background:#b32d2e !important; color:#fff !important; font-weight:600; }
		#wpadminbar { border-bottom:3px solid #b32d2e; }
	</style>';
} );
