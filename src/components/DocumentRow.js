// ------------------------------------------------------------------
// One document in the library list.
//
// Memoised because the list is rendered by mapping inside a FlatList
// section, so without this every row re-rendered on every keystroke in the
// search box, every ad-free countdown tick, and every unrelated state change
// in App.js — each row decoding its own thumbnail again.
// ------------------------------------------------------------------
import React from 'react';
import { Image, Text, TouchableOpacity, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';

import AnimatedCard from './AnimatedCard.js';

function DocumentRow({
	doc,
	index,
	selected,
	selectionMode,
	styles,
	theme,
	onPress,
	onLongPress,
	onShare,
}) {
	return (
		<AnimatedCard
			delay={Math.min(index, 5) * 45}
			style={[styles.listCard, selected && styles.selectedBorder]}>
			<TouchableOpacity
				activeOpacity={0.75}
				onPress={() => onPress(doc)}
				onLongPress={() => onLongPress(doc)}
				delayLongPress={350}
				style={styles.listCardInner}>
				{selectionMode && (
					<View style={[styles.checkbox, selected && styles.checkboxOn]}>
						{selected && <Feather name='check' size={11} color='#fff' />}
					</View>
				)}
				{doc.thumbnailUri ? (
					<Image source={{ uri: doc.thumbnailUri }} style={styles.listThumb} />
				) : (
					<View style={styles.listThumbEmpty}>
						<MaterialCommunityIcons
							name='file-pdf-box'
							size={26}
							color={theme.primaryBlue}
						/>
					</View>
				)}
				<View style={styles.listText}>
					<Text style={styles.listTitle} numberOfLines={1}>
						{doc.title}
					</Text>
					<Text style={styles.listSub}>
						{doc.date} at {doc.time}
					</Text>
					<View style={styles.badgeRow}>
						<View style={styles.badge}>
							{/* An imported PDF has no page count — nothing here can
							    read one out of a PDF, so it is not invented. */}
							<Text style={styles.badgeTxt}>
								{doc.pages == null
									? 'Imported'
									: `${doc.pages} page${doc.pages > 1 ? 's' : ''}`}
							</Text>
						</View>
						<View
							style={[
								styles.badge,
								{
									backgroundColor: theme.secondaryTeal + '28',
									marginLeft: 6,
								},
							]}>
							<Text style={[styles.badgeTxt, { color: theme.primaryTeal }]}>
								{doc.size} MB
							</Text>
						</View>
						{doc.editable && (
							<View
								style={[
									styles.badge,
									{
										backgroundColor: theme.primaryBlue + '22',
										marginLeft: 6,
									},
								]}>
								<Text style={[styles.badgeTxt, { color: theme.accent }]}>
									Editable
								</Text>
							</View>
						)}
					</View>
				</View>
				{!selectionMode && (
					<TouchableOpacity
						style={styles.quickShare}
						onPress={() => onShare(doc)}
						hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
						<Feather name='share' size={15} color={theme.accent} />
					</TouchableOpacity>
				)}
			</TouchableOpacity>
		</AnimatedCard>
	);
}

// `styles` and `theme` are recreated only when the theme changes, and the
// handlers are useCallback'd in App.js, so a shallow compare is enough.
export default React.memo(DocumentRow);
