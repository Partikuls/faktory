<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * @param array<string, string> $columns
 * @return array<string, string>
 */
function faktory_catalogue_produits_columns( array $columns ): array {
	$out = array();
	foreach ( $columns as $key => $label ) {
		if ( 'title' === $key ) {
			$out['faktory_thumb'] = 'Photo';
		}
		$out[ $key ] = $label;
		if ( 'title' === $key ) {
			$out['faktory_prix']          = 'Prix';
			$out['faktory_disponibilite'] = 'Disponibilité';
			$out['faktory_mis_en_avant']  = 'Mis en avant';
		}
	}
	return $out;
}
add_filter( 'manage_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_posts_columns', 'faktory_catalogue_produits_columns' );

function faktory_catalogue_produits_column_content( string $column, int $post_id ): void {
	switch ( $column ) {
		case 'faktory_thumb':
			echo has_post_thumbnail( $post_id ) ? get_the_post_thumbnail( $post_id, array( 48, 48 ) ) : '—';
			break;
		case 'faktory_prix':
			$prix = (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'prix' ), true );
			echo '' === $prix ? '—' : esc_html( number_format( (float) $prix, 2, ',', ' ' ) . ' €' );
			break;
		case 'faktory_disponibilite':
			echo esc_html( (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'disponibilite' ), true ) );
			break;
		case 'faktory_mis_en_avant':
			echo '1' === (string) get_post_meta( $post_id, faktory_catalogue_produits_meta_key( 'mis_en_avant' ), true ) ? '★' : '—';
			break;
	}
}
add_action( 'manage_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_posts_custom_column', 'faktory_catalogue_produits_column_content', 10, 2 );

/**
 * @param array<string, string> $columns
 * @return array<string, string>
 */
function faktory_catalogue_produits_sortable_columns( array $columns ): array {
	$columns['faktory_prix'] = 'faktory_prix';
	return $columns;
}
add_filter( 'manage_edit-' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_sortable_columns', 'faktory_catalogue_produits_sortable_columns' );

function faktory_catalogue_produits_orderby( WP_Query $query ): void {
	if ( ! is_admin() || ! $query->is_main_query() || 'faktory_prix' !== $query->get( 'orderby' ) ) {
		return;
	}
	// pre_get_posts touche toutes les listes : ne trier que celle de ce type de contenu.
	if ( FAKTORY_CATALOGUE_PRODUITS_POST_TYPE !== $query->get( 'post_type' ) ) {
		return;
	}
	$query->set( 'meta_key', faktory_catalogue_produits_meta_key( 'prix' ) );
	$query->set( 'orderby', 'meta_value_num' );
}
add_action( 'pre_get_posts', 'faktory_catalogue_produits_orderby' );
