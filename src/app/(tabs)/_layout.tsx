import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';

import { GlassSurface } from '@/components/ui/GlassSurface';
import { Colors } from '@/constants/theme';
import { usePreferences } from '@/store/preferences';

export default function TabsLayout() {
  const showOutcomeMarkets = usePreferences((state) => state.showOutcomeMarkets);

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: Colors.background },
        headerTitleStyle: {
          color: Colors.text,
          fontSize: 20,
          fontWeight: '700',
          letterSpacing: -0.35,
        },
        headerTintColor: Colors.text,
        headerShadowVisible: false,
        tabBarStyle: styles.tabBar,
        tabBarBackground: () => <GlassSurface style={StyleSheet.absoluteFill} />,
        tabBarActiveTintColor: Colors.text,
        tabBarInactiveTintColor: Colors.textFaint,
        tabBarLabelStyle: styles.tabLabel,
        tabBarItemStyle: styles.tabItem,
        tabBarHideOnKeyboard: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Watchlist',
          headerShown: false,
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bookmark' : 'bookmark-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="markets"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'stats-chart' : 'stats-chart-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Protected guard={showOutcomeMarkets}>
        <Tabs.Screen
          name="outcomes"
          options={{
            title: 'Outcomes',
            headerShown: false,
            tabBarIcon: ({ color, focused }) => (
              <Ionicons name={focused ? 'radio-button-on' : 'radio-button-on-outline'} color={color} size={22} />
            ),
          }}
        />
      </Tabs.Protected>
      <Tabs.Screen
        name="news"
        options={{
          title: 'News',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'newspaper' : 'newspaper-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: 'Account',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'wallet' : 'wallet-outline'} color={color} size={22} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'settings' : 'settings-outline'} color={color} size={22} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'transparent',
    borderTopWidth: 0,
    elevation: 0,
  },
  tabItem: { paddingTop: 4 },
  tabLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
});
