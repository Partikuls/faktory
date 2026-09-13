<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Champs de la spec (hors « photo » = image à la une).
 *
 * @return array<string, array{label: string, type: string, options?: list<string>}>
 */
function faktory_catalogue_produits_fields(): array {
	return array(
		'prix'          => array(
			'label' => 'Prix',
			'type'  => 'price',
		),
		'disponibilite' => array(
			'label'   => 'Disponibilité',
			'type'    => 'select',
			'options' => array( 'Tous les jours', 'Week-end', 'Sur commande' ),
		),
		'mis_en_avant'  => array(
			'label' => "Mis en avant sur l'accueil",
			'type'  => 'boolean',
		),
	);
}

function faktory_catalogue_produits_meta_key( string $field ): string {
	return '_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE . '_' . $field;
}

/**
 * @param mixed $value
 */
function faktory_catalogue_produits_sanitize( string $key, $value ): string {
	$fields = faktory_catalogue_produits_fields();
	if ( ! isset( $fields[ $key ] ) ) {
		return '';
	}
	$field = $fields[ $key ];
	$raw   = is_scalar( $value ) ? trim( (string) $value ) : '';
	switch ( $field['type'] ) {
		case 'price':
		case 'number':
			return '' === $raw ? '' : number_format( (float) str_replace( ',', '.', $raw ), 2, '.', '' );
		case 'select':
			return in_array( $raw, $field['options'] ?? array(), true ) ? $raw : '';
		case 'boolean':
			return in_array( $raw, array( '1', 'on', 'true' ), true ) ? '1' : '';
		case 'date':
			return 1 === preg_match( '/^\d{4}-\d{2}-\d{2}$/', $raw ) ? $raw : '';
		case 'url':
			return esc_url_raw( $raw );
		case 'textarea':
			return sanitize_textarea_field( $raw );
		default:
			return sanitize_text_field( $raw );
	}
}

function faktory_catalogue_produits_register_meta(): void {
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		register_post_meta(
			FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
			faktory_catalogue_produits_meta_key( $key ),
			array(
				'type'              => 'string',
				'single'            => true,
				'default'           => '',
				'show_in_rest'      => true,
				'sanitize_callback' => static fn( $value ): string => faktory_catalogue_produits_sanitize( $key, $value ),
				// Signature WordPress : ( bool $allowed, string $meta_key, int $object_id, int $user_id, string $cap, array $caps ).
				'auth_callback'     => static fn( bool $allowed, string $meta_key, int $object_id ): bool => current_user_can( 'edit_post', $object_id ),
			)
		);
	}
}
add_action( 'init', 'faktory_catalogue_produits_register_meta' );

function faktory_catalogue_produits_add_meta_box(): void {
	add_meta_box(
		'faktory_catalogue_produits_fields',
		'Informations produit',
		'faktory_catalogue_produits_render_meta_box',
		FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		'normal',
		'high'
	);
}
add_action( 'add_meta_boxes', 'faktory_catalogue_produits_add_meta_box' );

function faktory_catalogue_produits_render_meta_box( WP_Post $post ): void {
	wp_nonce_field( 'faktory_catalogue_produits_save', 'faktory_catalogue_produits_nonce' );
	echo '<table class="form-table"><tbody>';
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		$value = (string) get_post_meta( $post->ID, faktory_catalogue_produits_meta_key( $key ), true );
		$id    = esc_attr( 'faktory_' . $key );
		$name  = esc_attr( 'faktory_catalogue_produits[' . $key . ']' );
		echo '<tr><th scope="row"><label for="' . $id . '">' . esc_html( $field['label'] ) . '</label></th><td>';
		switch ( $field['type'] ) {
			case 'textarea':
				echo '<textarea id="' . $id . '" name="' . $name . '" rows="4" class="large-text">' . esc_textarea( $value ) . '</textarea>';
				break;
			case 'select':
				echo '<select id="' . $id . '" name="' . $name . '"><option value="">—</option>';
				foreach ( $field['options'] ?? array() as $option ) {
					echo '<option value="' . esc_attr( $option ) . '"' . selected( $value, $option, false ) . '>' . esc_html( $option ) . '</option>';
				}
				echo '</select>';
				break;
			case 'boolean':
				echo '<label><input type="checkbox" id="' . $id . '" name="' . $name . '" value="1"' . checked( $value, '1', false ) . '> Oui</label>';
				break;
			case 'price':
			case 'number':
				echo '<input type="number" step="0.01" min="0" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '" class="small-text">' . ( 'price' === $field['type'] ? ' €' : '' );
				break;
			case 'date':
				echo '<input type="date" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '">';
				break;
			default:
				echo '<input type="text" id="' . $id . '" name="' . $name . '" value="' . esc_attr( $value ) . '" class="regular-text">';
		}
		echo '</td></tr>';
	}
	echo '</tbody></table>';
}

function faktory_catalogue_produits_save_meta( int $post_id ): void {
	$nonce = isset( $_POST['faktory_catalogue_produits_nonce'] ) ? stripslashes( (string) $_POST['faktory_catalogue_produits_nonce'] ) : '';
	if ( '' === $nonce || false === wp_verify_nonce( sanitize_key( $nonce ), 'faktory_catalogue_produits_save' ) ) {
		return;
	}
	if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
		return;
	}
	if ( ! current_user_can( 'edit_post', $post_id ) ) {
		return;
	}
	$input = isset( $_POST['faktory_catalogue_produits'] ) && is_array( $_POST['faktory_catalogue_produits'] ) ? $_POST['faktory_catalogue_produits'] : array();
	foreach ( faktory_catalogue_produits_fields() as $key => $field ) {
		$raw = $input[ $key ] ?? '';
		if ( is_string( $raw ) ) {
			$raw = stripslashes( $raw );
		}
		update_post_meta( $post_id, faktory_catalogue_produits_meta_key( $key ), faktory_catalogue_produits_sanitize( $key, $raw ) );
	}
}
add_action( 'save_post_' . FAKTORY_CATALOGUE_PRODUITS_POST_TYPE, 'faktory_catalogue_produits_save_meta' );
