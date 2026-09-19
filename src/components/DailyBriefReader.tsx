import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DailyBriefContent, openBriefSource } from '@/components/DailyBriefContent';
import { AppText } from '@/components/ui/AppText';
import { Colors } from '@/constants/theme';
import { useDailyBrief } from '@/data/useDailyBrief';
import { DAILY_BRIEF_URL } from '@/providers/briefs/client';
import { editionStatus, formatBriefDate } from '../../web/src/lib/dailyBrief';

export function DailyBriefReader() {
  const { brief, loading, refreshing, error, refresh, now } = useDailyBrief();
  const [contentsOpen, setContentsOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const scroller = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const insets = useSafeAreaInsets();
  useEffect(() => {
    scroller.current?.scrollTo({ y: 0, animated: false });
  }, [brief?.id]);

  const share = async () => {
    if (!brief) return;
    try { await Share.share({ title: brief.title, message: `${brief.title}\n${formatBriefDate(brief.id)}\n\n${brief.raw}\n\n${DAILY_BRIEF_URL}` }); }
    catch { Alert.alert('Unable to share brief', 'Please try again.'); }
  };

  if (!brief) return <View style={styles.empty}>
    {loading ? <ActivityIndicator color={Colors.accent} accessibilityLabel="Loading daily brief" /> : <Ionicons name="newspaper-outline" color={Colors.textMuted} size={32} />}
    {!loading && <AppText style={styles.emptyTitle}>Brief unavailable</AppText>}
    {!loading && <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retry}><AppText style={styles.linkText}>Try again</AppText></Pressable>}
  </View>;

  const status = editionStatus(brief, brief.id, now);
  const rows = brief.sections.map((section, index) => ({ id: section.id, title: section.title, subtitle: `Section ${String(index + 1).padStart(2, '0')}` }));

  return <>
    <ScrollView ref={scroller} testID="daily-brief-reader" contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={Colors.accent} />}>
      <View style={styles.masthead}>
        <View style={styles.mastheadCopy}>
          <AppText accessibilityRole="header" style={styles.title}>Daily brief<AppText style={styles.titleDot}>.</AppText></AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Share this brief" onPress={() => void share()} style={styles.iconButton}>
          <Ionicons name="share-outline" size={21} color={Colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.editionBar}>
        <AppText style={styles.dateText}>{formatBriefDate(brief.id, 'short')}</AppText>
        <AppText style={styles.readingTime}>{brief.readingMinutes} min read</AppText>
      </View>

      {error && <View style={styles.notice}><AppText style={styles.noticeText}>Couldn’t refresh · Showing saved edition</AppText><Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retry}><AppText style={styles.linkText}>Retry</AppText></Pressable></View>}

      <View style={styles.articleHeader}>
        <AppText style={styles.status}>{status === 'today' ? 'TODAY’S EDITION' : 'LATEST AVAILABLE EDITION'}</AppText>
        <AppText accessibilityRole="header" style={styles.headline}>{brief.title}</AppText>
        {status !== 'today' && <AppText style={styles.cutoffNote}>A newer brief has not been published yet. Figures reflect the cutoff below.</AppText>}
        <View style={styles.metadata}>
          <View style={styles.metadataRow}><AppText style={styles.metadataLabel}>GENERATED</AppText><AppText style={styles.metadataValue}>{brief.generated.slice(11)} · Europe/London</AppText></View>
          <View style={styles.metadataRow}><AppText style={styles.metadataLabel}>MARKET STATE</AppText><AppText style={styles.metadataValue}>{brief.marketState}</AppText></View>
          <View style={styles.metadataRow}><AppText style={styles.metadataLabel}>DATA CUTOFF</AppText><AppText style={styles.metadataValue}>{brief.cutoff}</AppText></View>
        </View>
      </View>

      <Pressable accessibilityRole="button" accessibilityLabel="Jump to a brief section" onPress={() => setContentsOpen(true)} style={styles.contentsButton}>
        <View style={styles.contentsLabel}><Ionicons name="list-outline" size={18} color={Colors.textMuted} /><AppText style={styles.contentsText}>In this brief</AppText></View>
        <AppText style={styles.sectionCount}>{brief.sections.length} sections</AppText><Ionicons name="chevron-down" size={15} color={Colors.textMuted} />
      </Pressable>

      {brief.sections.map((section, index) => <View key={`${brief.id}:${section.id}`} style={styles.section} onLayout={(event) => { sectionPositions.current[section.id] = event.nativeEvent.layout.y; }}>
        <View style={styles.sectionHeading}><AppText style={styles.sectionNumber}>{String(index + 1).padStart(2, '0')}</AppText><AppText accessibilityRole="header" style={styles.sectionTitle}>{section.title}</AppText></View>
        <DailyBriefContent blocks={section.blocks} lead={index === 0} />
      </View>)}

      <Pressable accessibilityRole="button" accessibilityState={{ expanded: sourcesOpen }} onPress={() => setSourcesOpen(!sourcesOpen)} style={styles.sourcesButton}>
        <AppText style={styles.sourcesTitle}>Sources for this edition</AppText><AppText style={styles.sourceCount}>{brief.sources.length}</AppText><Ionicons name={sourcesOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
      </Pressable>
      {sourcesOpen && <View style={styles.sources}>{brief.sources.map((source, index) => <Pressable key={source.href} accessibilityRole="link" onPress={() => void openBriefSource(source.href)} style={styles.source}>
        <AppText style={styles.sectionNumber}>{String(index + 1).padStart(2, '0')}</AppText><View style={styles.sourceBody}><AppText style={styles.sourceLabel}>{source.label}</AppText><AppText style={styles.sourceHost}>{new URL(source.href).hostname.replace(/^www\./, '')}</AppText></View><Ionicons name="open-outline" size={16} color={Colors.textMuted} />
      </Pressable>)}</View>}
      <View style={styles.footer}><AppText style={styles.footerLabel}>END OF BRIEF · {formatBriefDate(brief.id, 'short')}</AppText><Pressable accessibilityRole="button" onPress={() => scroller.current?.scrollTo({ y: 0, animated: true })} style={styles.retry}><AppText style={styles.linkText}>Back to top</AppText></Pressable></View>
    </ScrollView>

    <Modal visible={contentsOpen} transparent animationType="slide" onRequestClose={() => setContentsOpen(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close brief menu" style={StyleSheet.absoluteFill} onPress={() => setContentsOpen(false)} />
        <View accessibilityViewIsModal style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}><AppText accessibilityRole="header" style={styles.sheetTitle}>In this brief</AppText><Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={() => setContentsOpen(false)} style={styles.iconButton}><Ionicons name="close" size={22} color={Colors.textMuted} /></Pressable></View>
          <ScrollView>{rows.map((row) => <Pressable key={row.id} accessibilityRole="button" onPress={() => {
            setContentsOpen(false); requestAnimationFrame(() => scroller.current?.scrollTo({ y: Math.max(0, (sectionPositions.current[row.id] ?? 0) - 16), animated: true }));
          }} style={styles.sheetRow}>
            <View style={styles.sheetRowBody}><AppText style={styles.sheetRowTitle}>{row.title}</AppText><AppText style={styles.sheetRowSubtitle}>{row.subtitle}</AppText></View>
            <Ionicons name="chevron-forward" size={18} color={Colors.textFaint} />
          </Pressable>)}</ScrollView>
        </View>
      </View>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  content: { padding: 24, maxWidth: 760, width: '100%', alignSelf: 'center' },
  masthead: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 24 },
  mastheadCopy: { flex: 1 },
  title: { fontSize: 30, lineHeight: 36, letterSpacing: -1, fontWeight: '600' },
  titleDot: { fontSize: 30, lineHeight: 36, color: '#9BCABC' },
  iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  editionBar: { flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: Colors.border, marginBottom: 28, paddingVertical: 16 },
  dateText: { fontSize: 13, fontWeight: '500' },
  readingTime: { flex: 1, textAlign: 'right', fontSize: 10, color: Colors.textMuted },
  articleHeader: { gap: 14 },
  status: { color: '#9BCABC', fontSize: 9, letterSpacing: 1, lineHeight: 15 },
  headline: { fontSize: 31, lineHeight: 37, fontWeight: '500', letterSpacing: -0.9 },
  cutoffNote: { color: Colors.textMuted, fontSize: 12, lineHeight: 19 },
  metadata: { gap: 12, paddingVertical: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  metadataRow: { flexDirection: 'row', gap: 12 },
  metadataLabel: { width: 84, fontSize: 8, lineHeight: 18, letterSpacing: 0.4, color: Colors.textFaint },
  metadataValue: { flex: 1, color: Colors.textMuted, fontSize: 11, lineHeight: 18 },
  contentsButton: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 52, marginTop: 12, marginBottom: 24 },
  contentsLabel: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'center' },
  contentsText: { fontSize: 13, color: Colors.textMuted },
  sectionCount: { fontSize: 11, color: Colors.textFaint },
  section: { paddingBottom: 15, marginBottom: 28, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  sectionHeading: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 18 },
  sectionNumber: { fontSize: 10, lineHeight: 22, color: Colors.textFaint, fontVariant: ['tabular-nums'] },
  sectionTitle: { flex: 1, fontSize: 18, lineHeight: 25, fontWeight: '500', letterSpacing: -0.3 },
  sourcesButton: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 48 },
  sourcesTitle: { flex: 1, fontSize: 15, fontWeight: '500' },
  sourceCount: { color: Colors.textMuted, fontSize: 12 },
  sources: { marginTop: 12 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  sourceBody: { flex: 1, gap: 3 },
  sourceLabel: { fontSize: 14, lineHeight: 21, color: '#9BCABC' },
  sourceHost: { fontSize: 11, color: Colors.textFaint },
  footer: { marginTop: 28, gap: 10, alignItems: 'flex-start' },
  footerLabel: { color: Colors.textFaint, fontSize: 9, letterSpacing: 0.6 },
  linkText: { color: Colors.accent, fontSize: 13, fontWeight: '500' },
  retry: { minHeight: 44, justifyContent: 'center' },
  notice: { paddingBottom: 16 },
  noticeText: { color: Colors.warning, fontSize: 12, lineHeight: 19 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36, gap: 14 },
  emptyTitle: { fontSize: 21, lineHeight: 28, fontWeight: '500', textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%', paddingHorizontal: 24 },
  sheetHandle: { height: 4, width: 32, borderRadius: 2, backgroundColor: Colors.textFaint, opacity: 0.5, alignSelf: 'center', marginTop: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  sheetTitle: { flex: 1, fontSize: 22, lineHeight: 28, fontWeight: '600' },
  sheetRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 15, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  sheetRowBody: { flex: 1, gap: 5 },
  sheetRowTitle: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
  sheetRowSubtitle: { fontSize: 12, lineHeight: 18, color: Colors.textMuted },
});
