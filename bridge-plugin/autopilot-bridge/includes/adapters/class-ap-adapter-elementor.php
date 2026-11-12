<?php
defined( 'ABSPATH' ) || exit;

/**
 * Elementor: edits the _elementor_data element tree by element id.
 *
 * Payload modes:
 *   settings      {settings:{...}}          shallow-merge into the element's settings
 *   replace       {element:{...}}           replace the element (keeps id unless given)
 *   insert_before {element:{...}}           new sibling before the target
 *   insert_after  {element:{...}}           new sibling after the target
 *   append_child  {element:{...}}           new last child (target must be section/column/container)
 *   remove        {}                        remove the target
 */
class AP_Adapter_Elementor {
	const META     = '_elementor_data';
	const EL_TYPES = array( 'section', 'column', 'container', 'widget' );

	public static function is_elementor( $post_id ) {
		return 'builder' === get_post_meta( $post_id, '_elementor_edit_mode', true );
	}

	/** @return string|WP_Error new JSON */
	public static function apply( $json, $element_id, $payload ) {
		$tree = json_decode( (string) $json, true );
		if ( ! is_array( $tree ) ) {
			return new WP_Error( 'ap_elementor_data', 'Page has no valid Elementor data.' );
		}
		$mode = (string) ( $payload['mode'] ?? '' );
		$ids  = array();
		self::collect_ids( $tree, $ids );

		$new = null;
		if ( in_array( $mode, array( 'replace', 'insert_before', 'insert_after', 'append_child' ), true ) ) {
			if ( empty( $payload['element'] ) || ! is_array( $payload['element'] ) ) {
				return new WP_Error( 'ap_payload', "Mode $mode needs payload.element." );
			}
			$keep = ( 'replace' === $mode ) ? (string) $element_id : '';
			$new  = self::normalize( $payload['element'], $ids, $keep );
			if ( is_wp_error( $new ) ) {
				return $new;
			}
		} elseif ( 'settings' === $mode ) {
			if ( ! isset( $payload['settings'] ) || ! is_array( $payload['settings'] ) ) {
				return new WP_Error( 'ap_payload', 'Mode settings needs payload.settings.' );
			}
		} elseif ( 'remove' !== $mode ) {
			return new WP_Error( 'ap_payload', 'Unknown Elementor mode: ' . $mode );
		}

		$error = null;
		$fn    = function ( $el ) use ( $mode, $payload, $new, &$error ) {
			switch ( $mode ) {
				case 'settings':
					$cur            = ( isset( $el['settings'] ) && is_array( $el['settings'] ) ) ? $el['settings'] : array();
					$el['settings'] = array_replace( $cur, $payload['settings'] );
					return array( $el );
				case 'replace':
					return array( $new );
				case 'insert_before':
					return array( $new, $el );
				case 'insert_after':
					return array( $el, $new );
				case 'append_child':
					if ( 'widget' === ( $el['elType'] ?? '' ) ) {
						$error = new WP_Error( 'ap_payload', 'Cannot append a child to a widget.' );
						return array( $el );
					}
					$el['elements']   = ( isset( $el['elements'] ) && is_array( $el['elements'] ) ) ? $el['elements'] : array();
					$el['elements'][] = $new;
					return array( $el );
				case 'remove':
					return array();
			}
			return array( $el );
		};

		$found = false;
		$tree  = self::walk( $tree, (string) $element_id, $fn, $found );
		if ( ! $found ) {
			return new WP_Error( 'ap_not_found', "Element $element_id not found." );
		}
		if ( $error ) {
			return $error;
		}
		return wp_json_encode( $tree );
	}

	/** Compact outline for inventory: ids, types and short scalar settings. */
	public static function outline( $json ) {
		$tree = json_decode( (string) $json, true );
		return is_array( $tree ) ? self::outline_nodes( $tree ) : array();
	}

	private static function outline_nodes( $els ) {
		$out = array();
		foreach ( $els as $el ) {
			if ( ! is_array( $el ) ) {
				continue;
			}
			$n = array(
				'id'   => $el['id'] ?? '',
				'type' => ( 'widget' === ( $el['elType'] ?? '' ) ) ? ( $el['widgetType'] ?? 'widget' ) : ( $el['elType'] ?? '' ),
			);
			$s = array();
			foreach ( (array) ( $el['settings'] ?? array() ) as $k => $v ) {
				if ( is_string( $v ) && '' !== trim( $v ) && '_' !== $k[0] ) {
					$s[ $k ] = mb_substr( wp_strip_all_tags( $v ), 0, 80 );
				}
			}
			if ( $s ) {
				$n['s'] = $s;
			}
			if ( ! empty( $el['elements'] ) ) {
				$n['c'] = self::outline_nodes( $el['elements'] );
			}
			$out[] = $n;
		}
		return $out;
	}

	private static function walk( array $els, $id, callable $fn, &$found ) {
		$out = array();
		foreach ( $els as $el ) {
			if ( ! $found && is_array( $el ) && isset( $el['id'] ) && (string) $el['id'] === $id ) {
				$found = true;
				foreach ( $fn( $el ) as $r ) {
					$out[] = $r;
				}
				continue;
			}
			if ( ! $found && is_array( $el ) && ! empty( $el['elements'] ) && is_array( $el['elements'] ) ) {
				$el['elements'] = self::walk( $el['elements'], $id, $fn, $found );
			}
			$out[] = $el;
		}
		return $out;
	}

	private static function collect_ids( $els, &$ids ) {
		foreach ( (array) $els as $el ) {
			if ( is_array( $el ) ) {
				if ( isset( $el['id'] ) ) {
					$ids[ (string) $el['id'] ] = true;
				}
				if ( ! empty( $el['elements'] ) ) {
					self::collect_ids( $el['elements'], $ids );
				}
			}
		}
	}

	/** Validate structure; assign unique ids. */
	private static function normalize( $el, &$ids, $keep_id = '' ) {
		if ( ! is_array( $el ) || ! in_array( $el['elType'] ?? '', self::EL_TYPES, true ) ) {
			return new WP_Error( 'ap_payload', 'Element needs a valid elType.' );
		}
		if ( 'widget' === $el['elType'] && ( empty( $el['widgetType'] ) || ! is_string( $el['widgetType'] ) ) ) {
			return new WP_Error( 'ap_payload', 'Widget needs widgetType.' );
		}
		if ( '' !== $keep_id ) {
			$el['id'] = $keep_id;
		} else {
			$id = isset( $el['id'] ) ? (string) $el['id'] : '';
			if ( '' === $id || isset( $ids[ $id ] ) || ! preg_match( '/^[a-z0-9]{1,16}$/', $id ) ) {
				do {
					$id = substr( bin2hex( random_bytes( 4 ) ), 0, 7 );
				} while ( isset( $ids[ $id ] ) );
			}
			$el['id']    = $id;
			$ids[ $id ]  = true;
		}
		$el['settings'] = ( isset( $el['settings'] ) && is_array( $el['settings'] ) ) ? $el['settings'] : array();
		$children       = ( isset( $el['elements'] ) && is_array( $el['elements'] ) ) ? $el['elements'] : array();
		$el['elements'] = array();
		foreach ( $children as $child ) {
			$c = self::normalize( $child, $ids );
			if ( is_wp_error( $c ) ) {
				return $c;
			}
			$el['elements'][] = $c;
		}
		$el['isInner'] = ! empty( $el['isInner'] );
		return $el;
	}
}
