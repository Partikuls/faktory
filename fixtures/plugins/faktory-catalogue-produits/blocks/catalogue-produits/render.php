<?php
/**
 * Rendu du bloc : délègue à la fonction de rendu partagée avec le shortcode.
 * $attributes est fourni par WordPress (register_block_type + "render").
 */
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}
echo faktory_catalogue_produits_render( isset( $attributes ) && is_array( $attributes ) ? $attributes : array() ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- échappé dans la fonction de rendu.
