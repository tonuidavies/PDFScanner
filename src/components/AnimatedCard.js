// A card that fades and lifts into place once, on mount.
//
// The animation is driven natively and runs a single time — re-triggering it
// on every render is what makes a list flicker while you scroll it.
import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export default function AnimatedCard({ children, style, delay = 0 }) {
	const fade = useRef(new Animated.Value(0)).current;
	const slide = useRef(new Animated.Value(24)).current;

	useEffect(() => {
		const animation = Animated.parallel([
			Animated.timing(fade, {
				toValue: 1,
				duration: 380,
				delay,
				useNativeDriver: true,
			}),
			Animated.timing(slide, {
				toValue: 0,
				duration: 380,
				delay,
				useNativeDriver: true,
			}),
		]);
		animation.start();
		// A row can be unmounted by the list before its staggered delay has
		// elapsed; without this the timer still fires against a dead node.
		return () => animation.stop();
	}, [delay, fade, slide]);

	return (
		<Animated.View
			style={[style, { opacity: fade, transform: [{ translateY: slide }] }]}>
			{children}
		</Animated.View>
	);
}
