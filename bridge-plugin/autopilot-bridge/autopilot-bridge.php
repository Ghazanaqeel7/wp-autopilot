<?php
/**
 * Plugin Name:       Autopilot Bridge
 * Description:       Secure bridge between this site and WP Autopilot: signed API, staged changesets with full-site preview links, snapshots and one-click rollback.
 * Version:           0.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Centric Tech
 * License:           GPL-2.0-or-later
 * Text Domain:       autopilot-bridge
 */

defined( 'ABSPATH' ) || exit;

define( 'AP_BRIDGE_VERSION', '0.2.0' );
define( 'AP_BRIDGE_FILE', __FILE__ );
define( 'AP_BRIDGE_DIR', plugin_dir_path( __FILE__ ) );

if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) && file_exists( ABSPATH . WPINC . '/sodium_compat/autoload.php' ) ) {
	require_once ABSPATH . WPINC . '/sodium_compat/autoload.php';
}

require_once AP_BRIDGE_DIR . 'includes/class-ap-store.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-auth.php';
require_once AP_BRIDGE_DIR . 'includes/adapters/class-ap-adapter-elementor.php';
require_once AP_BRIDGE_DIR . 'includes/adapters/class-ap-adapter-gutenberg.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-functions.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-changesets.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-preview.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-inventory.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-api.php';
require_once AP_BRIDGE_DIR . 'includes/class-ap-admin.php';

register_activation_hook( __FILE__, array( 'AP_Store', 'install' ) );

add_action( 'plugins_loaded', function () {
	if ( get_option( 'ap_bridge_db' ) !== AP_Store::DB_VERSION ) {
		AP_Store::install();
	}
	AP_API::init();
	AP_Preview::init();
	AP_Admin::init();
	add_action( 'wp_head', array( 'AP_Changesets', 'print_css' ), 99 );
}, 10 );

// After AP_Preview (init:0) so previews see the overlaid snippets; snippets run from init onward.
add_action( 'init', array( 'AP_Functions', 'boot' ), 1 );
