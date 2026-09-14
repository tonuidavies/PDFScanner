// ------------------------------------------------------------------
// Last line of defence against a blank screen.
//
// An uncaught render error in React Native unmounts the whole tree, and in a
// release build that is a white screen with no way out — indistinguishable
// from the 2.1(a) launch crash this app was already rejected for once. This
// catches it, shows something honest, and lets the user carry on.
//
// It cannot catch native exceptions (an AdMob or StoreKit abort happens below
// JavaScript), and it cannot catch errors thrown inside event handlers or
// async callbacks — only render, lifecycle and constructor errors.
// ------------------------------------------------------------------
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default class ErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error, info) {
		// Goes to the device log / crash reporter, not to a server — the app
		// makes no network calls and the privacy labels say so.
		console.log('Unhandled UI error:', error, info?.componentStack);
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;

		const dark = this.props.isDark !== false;
		const palette = dark
			? { bg: '#0D1117', card: '#161B22', text: '#F0F6FC', muted: '#8B949E' }
			: { bg: '#F6F8FA', card: '#FFFFFF', text: '#24292F', muted: '#6E7781' };

		return (
			<View style={[styles.root, { backgroundColor: palette.bg }]}>
				<View style={[styles.card, { backgroundColor: palette.card }]}>
					<Text style={[styles.title, { color: palette.text }]}>
						Something went wrong
					</Text>
					<Text style={[styles.body, { color: palette.muted }]}>
						Your saved documents are safe on this device. Tap below to return
						to the app.
					</Text>
					<ScrollView style={styles.detailBox}>
						<Text style={[styles.detail, { color: palette.muted }]}>
							{String(error?.message || error)}
						</Text>
					</ScrollView>
					<TouchableOpacity
						style={styles.button}
						onPress={() => this.setState({ error: null })}>
						<Text style={styles.buttonTxt}>TRY AGAIN</Text>
					</TouchableOpacity>
				</View>
			</View>
		);
	}
}

const styles = StyleSheet.create({
	root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
	card: { width: '100%', maxWidth: 460, borderRadius: 20, padding: 26 },
	title: { fontSize: 20, fontWeight: '800', marginBottom: 10 },
	body: { fontSize: 14, lineHeight: 21, marginBottom: 16 },
	detailBox: { maxHeight: 140, marginBottom: 20 },
	detail: { fontSize: 12, lineHeight: 18 },
	button: {
		backgroundColor: '#1A73E8',
		paddingVertical: 14,
		borderRadius: 13,
		alignItems: 'center',
	},
	buttonTxt: {
		color: '#fff',
		fontWeight: '800',
		fontSize: 13,
		letterSpacing: 0.6,
	},
});
