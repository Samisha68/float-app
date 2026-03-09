// ── Polyfills — must be imported FIRST before any Solana/Anchor code ─────────
import "react-native-get-random-values";         // crypto.getRandomValues
import "react-native-url-polyfill/auto";          // URL, URLSearchParams
import { Buffer } from "@craftzdog/react-native-buffer";
// Make Buffer globally available (web3.js / Anchor expect it on global scope)
if (typeof global.Buffer === "undefined") {
  (global as any).Buffer = Buffer;
}
// ─────────────────────────────────────────────────────────────────────────────
import "react-native-gesture-handler";
import React from "react";
import { StatusBar } from "expo-status-bar";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createStackNavigator } from "@react-navigation/stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text } from "react-native";

import { WalletProvider } from "./src/context/WalletContext";
import { HomeScreen } from "./src/screens/HomeScreen";
import { CreateLoanScreen } from "./src/screens/CreateLoanScreen";
import { RepayScreen } from "./src/screens/RepayScreen";
import { HistoryScreen } from "./src/screens/HistoryScreen";
import { AIPoolDashboardScreen } from "./src/screens/AIPoolDashboardScreen";
import { DepositToPoolScreen } from "./src/screens/DepositToPoolScreen";
import { AgentPreferencesScreen } from "./src/screens/AgentPreferencesScreen";
import { AgentStatusScreen } from "./src/screens/AgentStatusScreen";
import { RepayMicroScreen } from "./src/screens/RepayMicroScreen";
import type { LoanData } from "./src/hooks/useLoans";
import type { MicroLoanData } from "./src/hooks/useMicroLoans";

// ── Navigation ────────────────────────────────────────────────────────────────

export type RootStackParamList = {
  Main: undefined;
  CreateLoan: undefined;
  Repay: { loan: LoanData; mode?: "repay" | "withdraw" };
  DepositToPool: undefined;
  AgentPreferences: undefined;
  AgentStatus: undefined;
  RepayMicro: { loan: MicroLoanData };
};

const Tab = createBottomTabNavigator();
const Stack = createStackNavigator<RootStackParamList>();

const FloatTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: "#050508",
    card: "#0C0C12",
    text: "#FAFAFC",
    border: "#1E1E2E",
    primary: "#6366F1",
    notification: "#6366F1",
  },
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "◎",
    AI: "◇",
    History: "◷",
  };
  return (
    <Text
      style={{
        fontSize: 22,
        opacity: focused ? 1 : 0.35,
        transform: [{ scale: focused ? 1.05 : 1 }],
      }}
    >
      {icons[label] ?? "●"}
    </Text>
  );
}

function HomeTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "rgba(12, 12, 18, 0.98)",
          borderTopColor: "rgba(30, 30, 46, 0.8)",
          borderTopWidth: 1,
          paddingBottom: 8,
          paddingTop: 8,
          height: 72,
        },
        tabBarActiveTintColor: "#818CF8",
        tabBarInactiveTintColor: "#475569",
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
        tabBarIcon: ({ focused }) => (
          <TabIcon label={route.name} focused={focused} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="AI" component={AIPoolDashboardScreen} />
      <Tab.Screen name="History" component={HistoryScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <WalletProvider>
    <SafeAreaProvider>
      <NavigationContainer theme={FloatTheme}>
        <StatusBar style="light" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Main" component={HomeTabs} />
          <Stack.Screen
            name="CreateLoan"
            component={CreateLoanScreen}
            options={{ presentation: "modal" }}
          />
          <Stack.Screen
            name="Repay"
            component={RepayScreen}
            options={{ presentation: "modal" }}
          />
          <Stack.Screen name="DepositToPool" component={DepositToPoolScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="AgentPreferences" component={AgentPreferencesScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="AgentStatus" component={AgentStatusScreen} options={{ presentation: "modal" }} />
          <Stack.Screen name="RepayMicro" component={RepayMicroScreen} options={{ presentation: "modal" }} />
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
    </WalletProvider>
  );
}
