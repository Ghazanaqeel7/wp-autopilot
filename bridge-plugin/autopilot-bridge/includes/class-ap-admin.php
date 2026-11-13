<?php
defined( 'ABSPATH' ) || exit;

/**
 * Tools → Autopilot Bridge: connect, pause (kill switch), disconnect, activity.
 */
class AP_Admin {
	const SLUG = 'autopilot-bridge';

	public static function init() {
		add_action( 'admin_menu', function () {
			add_management_page( 'Autopilot Bridge', 'Autopilot Bridge', 'manage_options', self::SLUG, array( __CLASS__, 'render' ) );
		} );
		add_action( 'admin_post_ap_bridge', array( __CLASS__, 'handle' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( AP_BRIDGE_FILE ), function ( $links ) {
			array_unshift( $links, '<a href="' . esc_url( admin_url( 'tools.php?page=' . self::SLUG ) ) . '">Settings</a>' );
			return $links;
		} );
	}

	public static function handle() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( 'Forbidden', 403 );
		}
		check_admin_referer( 'ap_bridge' );
		$do  = sanitize_key( $_POST['do'] ?? '' ); // phpcs:ignore
		$msg = '';
		if ( 'connect' === $do ) {
			$conn = AP_Auth::parse_code( wp_unslash( $_POST['code'] ?? '' ) ); // phpcs:ignore
			if ( is_wp_error( $conn ) ) {
				$msg = $conn->get_error_message();
			} else {
				update_option( 'ap_bridge_conn', $conn, false );
				AP_Store::audit( 'connected', $conn['site_id'], array( 'key_id' => $conn['key_id'] ) );
				$msg = 'Connected.';
			}
		} elseif ( 'pause' === $do ) {
			$paused = ! get_option( 'ap_bridge_paused' );
			update_option( 'ap_bridge_paused', $paused ? 1 : 0, false );
			AP_Store::audit( $paused ? 'paused' : 'resumed' );
			$msg = $paused ? 'Autopilot paused.' : 'Autopilot resumed.';
		} elseif ( 'code_mode' === $do ) {
			$m = sanitize_key( $_POST['mode'] ?? 'off' ); // phpcs:ignore
			$m = in_array( $m, array( 'off', 'snippets', 'all' ), true ) ? $m : 'off';
			update_option( AP_Functions::MODE, $m, false );
			AP_Store::audit( 'code_mode', $m );
			$msg = 'Code changes: ' . $m . '.';
		} elseif ( 'disconnect' === $do ) {
			delete_option( 'ap_bridge_conn' );
			AP_Store::audit( 'disconnected' );
			$msg = 'Disconnected.';
		}
		wp_safe_redirect( add_query_arg( array( 'page' => self::SLUG, 'ap_msg' => rawurlencode( $msg ) ), admin_url( 'tools.php' ) ) );
		exit;
	}

	private static function button( $do, $label, $class = 'button' ) {
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '" style="display:inline-block;margin-right:8px">';
		wp_nonce_field( 'ap_bridge' );
		echo '<input type="hidden" name="action" value="ap_bridge"><input type="hidden" name="do" value="' . esc_attr( $do ) . '">';
		echo '<button class="' . esc_attr( $class ) . '">' . esc_html( $label ) . '</button></form>';
	}

	public static function render() {
		$conn   = AP_Auth::conn();
		$health = AP_Inventory::health();
		$paused = (bool) get_option( 'ap_bridge_paused' );
		echo '<div class="wrap"><h1>Autopilot Bridge</h1>';
		if ( ! empty( $_GET['ap_msg'] ) ) { // phpcs:ignore
			echo '<div class="notice notice-info"><p>' . esc_html( sanitize_text_field( wp_unslash( $_GET['ap_msg'] ) ) ) . '</p></div>'; // phpcs:ignore
		}

		echo '<h2>Connection</h2>';
		if ( $conn ) {
			printf(
				'<p>Connected to <strong>%s</strong> as site <code>%s</code> (key <code>%s</code>) since %s.</p>',
				esc_html( $conn['hub'] ), esc_html( $conn['site_id'] ), esc_html( $conn['key_id'] ), esc_html( $conn['connected_at'] )
			);
			printf( '<p>Status: <strong style="color:%s">%s</strong></p>', $paused ? '#b32d2e' : '#008a20', $paused ? 'Paused — no changes will be accepted' : 'Active' );
			self::button( 'pause', $paused ? 'Resume Autopilot' : 'Pause Autopilot (kill switch)', $paused ? 'button button-primary' : 'button' );
			self::button( 'disconnect', 'Disconnect' );
		} else {
			echo '<p>Paste the connection code from your Autopilot dashboard.</p>';
			echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
			wp_nonce_field( 'ap_bridge' );
			echo '<input type="hidden" name="action" value="ap_bridge"><input type="hidden" name="do" value="connect">';
			echo '<textarea name="code" rows="4" class="large-text code" required></textarea>';
			echo '<p><button class="button button-primary">Connect</button></p></form>';
		}

		$mode = AP_Functions::mode();
		echo '<h2>Code changes</h2><p>Lets Autopilot add small code snippets and install WordPress.org plugins. Snippets are previewed first, switched off automatically if they crash, and can be rolled back. Keep this <strong>off</strong> on a live site unless you trust the setup; use <em>all</em> on a staging copy only.</p>';
		echo '<form method="post" action="' . esc_url( admin_url( 'admin-post.php' ) ) . '">';
		wp_nonce_field( 'ap_bridge' );
		echo '<input type="hidden" name="action" value="ap_bridge"><input type="hidden" name="do" value="code_mode"><select name="mode">';
		foreach ( array( 'off' => 'Off', 'snippets' => 'Snippets only (php/js/css)', 'all' => 'Snippets and plugin installs (staging)' ) as $k => $l ) {
			echo '<option value="' . esc_attr( $k ) . '"' . selected( $mode, $k, false ) . '>' . esc_html( $l ) . '</option>';
		}
		echo '</select> <button class="button">Save</button></form>';

		echo '<h2>Environment</h2><table class="widefat striped" style="max-width:640px"><tbody>';
		$rows = array(
			'WordPress'            => $health['wp'],
			'PHP'                  => $health['php'],
			'HTTPS'                => $health['https'] ? 'Yes' : 'No — required',
			'Signature support'    => $health['sodium'] ? 'Yes' : 'No — required',
			'REST endpoint'        => rest_url( AP_API::NS . '/health' ),
		);
		foreach ( $rows as $k => $v ) {
			echo '<tr><th style="width:200px">' . esc_html( $k ) . '</th><td>' . esc_html( $v ) . '</td></tr>';
		}
		echo '</tbody></table>';

		echo '<h2>Recent activity</h2><table class="widefat striped"><thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Object</th></tr></thead><tbody>';
		foreach ( AP_Store::recent_audit( 30 ) as $row ) {
			echo '<tr><td>' . esc_html( $row['ts'] ) . '</td><td>' . esc_html( $row['actor'] ) . '</td><td>' . esc_html( $row['action'] ) . '</td><td>' . esc_html( $row['object'] ) . '</td></tr>';
		}
		echo '</tbody></table></div>';
	}
}
