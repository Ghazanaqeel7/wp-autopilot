<?php
defined( 'ABSPATH' ) || exit;

/**
 * Gutenberg: edits post_content blocks addressed by index path, e.g. [2] or [2,0,1].
 *
 * Payload modes:
 *   attrs         {attrs:{...}}        shallow-merge block attributes (any depth)
 *   replace       {markup:"<!-- wp:… -->"}  replace with exactly one block (any depth)
 *   insert_before / insert_after {markup}   top-level only (path length 1)
 *   remove        {}                   top-level only
 */
class AP_Adapter_Gutenberg {

	/** @return string|WP_Error new post_content */
	public static function apply( $content, $path, $payload ) {
		if ( ! is_array( $path ) || ! $path ) {
			return new WP_Error( 'ap_payload', 'block_path must be a non-empty array of indexes.' );
		}
		$path   = array_map( 'intval', $path );
		$blocks = self::clean( parse_blocks( (string) $content ) );
		$mode   = (string) ( $payload['mode'] ?? '' );

		$new = array();
		if ( in_array( $mode, array( 'replace', 'insert_before', 'insert_after' ), true ) ) {
			$new = self::clean( parse_blocks( (string) ( $payload['markup'] ?? '' ) ) );
			if ( ! $new ) {
				return new WP_Error( 'ap_payload', 'payload.markup has no blocks.' );
			}
		}

		if ( count( $path ) > 1 ) {
			if ( ! in_array( $mode, array( 'attrs', 'replace' ), true ) ) {
				return new WP_Error( 'ap_payload', 'Nested paths support only attrs and replace.' );
			}
			if ( 'replace' === $mode && 1 !== count( $new ) ) {
				return new WP_Error( 'ap_payload', 'Nested replace needs exactly one block.' );
			}
		}

		$i = $path[0];
		if ( ! isset( $blocks[ $i ] ) ) {
			return new WP_Error( 'ap_not_found', 'Block path not found.' );
		}
		if ( count( $path ) > 1 ) {
			$res = self::nested( $blocks[ $i ], array_slice( $path, 1 ), $mode, $payload, $new );
			if ( is_wp_error( $res ) ) {
				return $res;
			}
			$blocks[ $i ] = $res;
		} else {
			switch ( $mode ) {
				case 'attrs':
					$blocks[ $i ]['attrs'] = array_replace( (array) $blocks[ $i ]['attrs'], (array) ( $payload['attrs'] ?? array() ) );
					break;
				case 'replace':
					array_splice( $blocks, $i, 1, $new );
					break;
				case 'insert_before':
					array_splice( $blocks, $i, 0, $new );
					break;
				case 'insert_after':
					array_splice( $blocks, $i + 1, 0, $new );
					break;
				case 'remove':
					array_splice( $blocks, $i, 1 );
					break;
				default:
					return new WP_Error( 'ap_payload', 'Unknown Gutenberg mode: ' . $mode );
			}
		}
		return self::join( $blocks );
	}

	public static function outline( $content ) {
		return self::outline_blocks( self::clean( parse_blocks( (string) $content ) ), array() );
	}

	private static function outline_blocks( $blocks, $prefix ) {
		$out = array();
		foreach ( $blocks as $i => $b ) {
			$p = array_merge( $prefix, array( $i ) );
			$n = array(
				'path' => $p,
				'type' => $b['blockName'] ?? 'freeform',
				't'    => mb_substr( trim( wp_strip_all_tags( (string) $b['innerHTML'] ) ), 0, 80 ),
			);
			if ( ! empty( $b['innerBlocks'] ) ) {
				$n['c'] = self::outline_blocks( $b['innerBlocks'], $p );
			}
			$out[] = $n;
		}
		return $out;
	}

	private static function nested( $block, $rest, $mode, $payload, $new ) {
		$i = $rest[0];
		if ( ! isset( $block['innerBlocks'][ $i ] ) ) {
			return new WP_Error( 'ap_not_found', 'Block path not found.' );
		}
		if ( count( $rest ) > 1 ) {
			$res = self::nested( $block['innerBlocks'][ $i ], array_slice( $rest, 1 ), $mode, $payload, $new );
			if ( is_wp_error( $res ) ) {
				return $res;
			}
			$block['innerBlocks'][ $i ] = $res;
			return $block;
		}
		if ( 'attrs' === $mode ) {
			$block['innerBlocks'][ $i ]['attrs'] = array_replace( (array) $block['innerBlocks'][ $i ]['attrs'], (array) ( $payload['attrs'] ?? array() ) );
		} else {
			$block['innerBlocks'][ $i ] = $new[0];
		}
		return $block;
	}

	/** Drop whitespace-only freeform blocks produced by the parser between blocks. */
	private static function clean( $blocks ) {
		return array_values( array_filter( $blocks, function ( $b ) {
			return ! ( null === $b['blockName'] && '' === trim( (string) $b['innerHTML'] ) );
		} ) );
	}

	private static function join( $blocks ) {
		return implode( "\n\n", array_map( 'serialize_block', $blocks ) );
	}
}
