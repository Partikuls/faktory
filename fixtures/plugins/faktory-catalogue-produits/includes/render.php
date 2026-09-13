<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * La seule fonction de rendu : utilisée par le bloc et par le shortcode.
 *
 * @param array<string, mixed> $args view (grid|featured), limit, filter, taxonomy, term.
 */
function faktory_catalogue_produits_render( array $args ): string {
	$view       = isset( $args['view'] ) && 'featured' === $args['view'] ? 'featured' : 'grid';
	$limit      = isset( $args['limit'] ) ? (int) $args['limit'] : ( 'featured' === $view ? 4 : 12 );
	$limit      = $limit > 0 ? $limit : -1;
	$filter     = ! empty( $args['filter'] );
	$taxonomy   = isset( $args['taxonomy'] ) && is_string( $args['taxonomy'] ) ? sanitize_key( $args['taxonomy'] ) : '';
	$term       = isset( $args['term'] ) && is_string( $args['term'] ) ? sanitize_title( $args['term'] ) : '';
	$taxonomies = array_keys( faktory_catalogue_produits_taxonomies() );
	$filter_tax = $taxonomies[0] ?? '';
	$active     = '';
	if ( $filter && '' !== $filter_tax && isset( $_GET[ $filter_tax ] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- lecture seule, filtre public.
		$active = sanitize_title( (string) $_GET[ $filter_tax ] );
	}
	if ( '' === $term && '' !== $active ) {
		$taxonomy = $filter_tax;
		$term     = $active;
	}

	wp_enqueue_style( 'faktory-catalogue-produits' );

	$query_args = array(
		'post_type'      => FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		'post_status'    => 'publish',
		'posts_per_page' => $limit,
		'orderby'        => 'date',
		'order'          => 'DESC',
		'no_found_rows'  => true,
	);
	if ( '' !== $taxonomy && '' !== $term ) {
		$query_args['tax_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
			array(
				'taxonomy' => $taxonomy,
				'field'    => 'slug',
				'terms'    => $term,
			),
		);
	}
	if ( 'featured' === $view ) {
		$query_args['meta_query'] = array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
			array(
				'key'   => faktory_catalogue_produits_meta_key( 'mis_en_avant' ),
				'value' => '1',
			),
		);
	}
	$posts = get_posts( $query_args );
	if ( 'featured' === $view && $limit > 0 && count( $posts ) < $limit ) {
		// Moins d'entrées « mises en avant » que demandé : on complète avec les plus récentes.
		$more  = get_posts(
			array(
				'post_type'      => FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
				'post_status'    => 'publish',
				'posts_per_page' => $limit - count( $posts ),
				'post__not_in'   => wp_list_pluck( $posts, 'ID' ),
				'orderby'        => 'date',
				'order'          => 'DESC',
				'no_found_rows'  => true,
			)
		);
		$posts = array_merge( $posts, $more );
	}

	$html = '<div class="' . esc_attr( 'faktory-catalogue-produits faktory-catalogue-produits--' . $view ) . '" data-faktory-plugin="catalogue_produits">';
	if ( $filter && '' !== $filter_tax ) {
		$html .= faktory_catalogue_produits_render_filter( $filter_tax, $active );
	}
	if ( empty( $posts ) ) {
		$html .= '<p class="faktory-catalogue-produits__empty">Aucun produit pour le moment.</p>';
	} else {
		$html .= '<ul class="faktory-catalogue-produits__grid">';
		foreach ( $posts as $post ) {
			if ( $post instanceof WP_Post ) {
				$html .= faktory_catalogue_produits_render_card( $post );
			}
		}
		$html .= '</ul>';
	}
	return $html . '</div>';
}

function faktory_catalogue_produits_render_filter( string $taxonomy, string $active ): string {
	$terms = get_terms(
		array(
			'taxonomy'   => $taxonomy,
			'hide_empty' => false,
		)
	);
	if ( ! is_array( $terms ) || empty( $terms ) ) {
		return '';
	}
	$base = remove_query_arg( $taxonomy );
	$html = '<nav class="faktory-catalogue-produits__filter" aria-label="Filtrer par catégorie"><ul>';
	$html .= '<li><a href="' . esc_url( $base ) . '"' . ( '' === $active ? ' aria-current="true"' : '' ) . '>Tout</a></li>';
	foreach ( $terms as $t ) {
		if ( ! $t instanceof WP_Term ) {
			continue;
		}
		$url   = add_query_arg( $taxonomy, $t->slug, $base );
		$html .= '<li><a href="' . esc_url( $url ) . '"' . ( $active === $t->slug ? ' aria-current="true"' : '' ) . '>' . esc_html( $t->name ) . '</a></li>';
	}
	return $html . '</ul></nav>';
}

function faktory_catalogue_produits_render_card( WP_Post $post ): string {
	$prix    = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( 'prix' ), true );
	$dispo   = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( 'disponibilite' ), true );
	$excerpt = has_excerpt( $post ) ? get_the_excerpt( $post ) : wp_trim_words( wp_strip_all_tags( $post->post_content ), 20 );
	$title   = get_the_title( $post );
	$html    = '<li class="faktory-catalogue-produits__card"><article>';
	if ( has_post_thumbnail( $post ) ) {
		$html .= '<div class="faktory-catalogue-produits__media">' . get_the_post_thumbnail(
			$post,
			'medium_large',
			array(
				'alt'     => $title,
				'loading' => 'lazy',
			)
		) . '</div>';
	}
	$html .= '<div class="faktory-catalogue-produits__body"><h3 class="faktory-catalogue-produits__title">' . esc_html( $title ) . '</h3>';
	if ( '' !== $excerpt ) {
		$html .= '<p class="faktory-catalogue-produits__text">' . esc_html( $excerpt ) . '</p>';
	}
	$html .= '<p class="faktory-catalogue-produits__meta">';
	if ( '' !== $prix ) {
		$html .= '<span class="faktory-catalogue-produits__price">' . esc_html( number_format( (float) $prix, 2, ',', ' ' ) ) . ' €</span>';
	}
	if ( '' !== $dispo ) {
		$html .= '<span class="faktory-catalogue-produits__badge">' . esc_html( $dispo ) . '</span>';
	}
	return $html . '</p></div></article></li>';
}
