import { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";

import MobileShell from "../components/MobileShell";
import BottomNav from "../components/BottomNav";

import {
  QRIcon,
  ClockIcon,
  PinIcon,
  PhoneIcon,
} from "../components/icons";

import { API_BASE } from "../api";


// ======================================================
// FALLBACK DATA
// ======================================================

const FALLBACK_DATA = {
  household_name: "Santos Household",

  nearest_center: {
    name: "Tibanga Gymnasium",
    distance_km: 0.8,
    walk_minutes: 10,
    status: "open",
    occupancy: 87,
    capacity: 300,
  },
};


// ======================================================
// BOTTOM NAVIGATION KEYS
// ======================================================

const EVACUATION_TABS = [
  "evacuate",
  "evacuation",
  "evac",
  "map",
  "route",
  "evacuation-map",
  "evacuationMap",
];


// ======================================================
// HOME SCREEN
// ======================================================

function HomeScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("home");


  // ====================================================
  // FETCH DASHBOARD
  // ====================================================

  useEffect(() => {
    const fetchDashboard = async () => {
      const mobileNumber =
        (await AsyncStorage.getItem(
          "geoaid_resident_mobile"
        )) || "";

      try {
        const response = await fetch(
          `${API_BASE}/api/resident/dashboard/?mobile_number=${encodeURIComponent(
            mobileNumber
          )}`
        );

        if (!response.ok) {
          throw new Error(
            `Dashboard request failed (${response.status})`
          );
        }

        const json = await response.json();

        setData(json);
      } catch (err) {
        console.warn(
          "Falling back to mock dashboard data:",
          err.message
        );

        setData(FALLBACK_DATA);
      }
    };

    fetchDashboard();
  }, []);


  // ====================================================
  // RESET HOME TAB WHEN SCREEN IS FOCUSED
  // ====================================================

  useEffect(() => {
    const unsubscribe = navigation.addListener(
      "focus",
      () => {
        setActiveTab("home");
      }
    );

    return unsubscribe;
  }, [navigation]);


  // ====================================================
  // LOADING
  // ====================================================

  if (!data) {
    return (
      <MobileShell>
        <SafeAreaView
          style={styles.loading}
          edges={["top", "bottom"]}
        >
          <Text>Loading dashboard…</Text>
        </SafeAreaView>
      </MobileShell>
    );
  }


  // ====================================================
  // DASHBOARD DATA
  // ====================================================

  const {
    household_name,
    nearest_center,
  } = data;


  const occupancyPct =
    nearest_center.capacity
      ? Math.min(
          100,
          Math.round(
            (nearest_center.occupancy /
              nearest_center.capacity) *
              100
          )
        )
      : 0;


  // ====================================================
  // BOTTOM NAVIGATION
  // ====================================================

  const handleTabSelect = (tab) => {
    if (tab === "profile") {
      navigation.navigate("Profile");

      return;
    }

    if (EVACUATION_TABS.includes(tab)) {
      navigation.navigate("EvacuationMap");

      return;
    }

    setActiveTab(tab);
  };


  // ====================================================
  // UI
  // ====================================================

  return (
    <MobileShell>

      {/*
        IMPORTANT:
        Only TOP safe area is handled here.

        BottomNav handles the bottom safe area itself.
      */}

      <SafeAreaView
        style={styles.screen}
        edges={["top"]}
      >

        {/* ============================================= */}
        {/* HEADER                                        */}
        {/* ============================================= */}

        <View style={styles.header}>
          <View style={styles.headerTextContainer}>
            <Text style={styles.greeting}>
              Good morning,
            </Text>

            <Text style={styles.householdName}>
              {household_name}
            </Text>
          </View>
        </View>


        {/* ============================================= */}
        {/* SCROLLABLE CONTENT                            */}
        {/* ============================================= */}

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          bounces
        >

          {/* =========================================== */}
          {/* QUICK ACTIONS                               */}
          {/* =========================================== */}

          <View style={styles.quickActions}>

            <TouchableOpacity
              style={[
                styles.quickAction,
                styles.qrAction,
              ]}
              onPress={() =>
                navigation.navigate("QRCode")
              }
              activeOpacity={0.8}
            >
              <QRIcon />

              <Text
                style={styles.quickActionLabel}
                numberOfLines={1}
              >
                My QR Code
              </Text>
            </TouchableOpacity>


            <TouchableOpacity
              style={[
                styles.quickAction,
                styles.registrationAction,
              ]}
              onPress={() =>
                navigation.navigate(
                  "RegistrationStatus"
                )
              }
              activeOpacity={0.8}
            >
              <ClockIcon />

              <Text
                style={styles.quickActionLabel}
                numberOfLines={1}
              >
                Reg. Status
              </Text>
            </TouchableOpacity>

          </View>


          {/* =========================================== */}
          {/* EMERGENCY CONTACTS                         */}
          {/* =========================================== */}

          <TouchableOpacity
            style={styles.emergencyContactsBtn}
            onPress={() =>
              navigation.navigate(
                "EmergencyContacts"
              )
            }
            activeOpacity={0.8}
          >
            <View style={styles.emergencyIconContainer}>
              <PhoneIcon color="#dc2626" />
            </View>

            <View style={styles.emergencyContactsText}>
              <Text
                style={styles.emergencyContactsTitle}
              >
                Emergency Contacts
              </Text>

              <Text
                style={
                  styles.emergencyContactsSubtitle
                }
              >
                Quick access to important numbers
              </Text>
            </View>
          </TouchableOpacity>


          {/* =========================================== */}
          {/* RELIEF DISTRIBUTION                        */}
          {/* =========================================== */}

          <TouchableOpacity
            style={styles.reliefAction}
            onPress={() =>
              navigation.navigate(
                "ReliefDistribution"
              )
            }
            activeOpacity={0.8}
          >
            <Text style={styles.reliefActionTitle}>
              Relief Distribution
            </Text>

            <Text
              style={styles.reliefActionSubtitle}
            >
              Check your relief status and history
            </Text>
          </TouchableOpacity>


          {/* =========================================== */}
          {/* NEAREST EVACUATION CENTER                  */}
          {/* =========================================== */}

          <View style={styles.section}>

            <Text style={styles.sectionLabel}>
              Nearest Evacuation Center
            </Text>


            <View style={styles.centerPanel}>

              {/* Center information */}

              <View style={styles.centerTop}>

                <View style={styles.centerInfo}>
                  <Text
                    style={styles.centerName}
                    numberOfLines={2}
                  >
                    {nearest_center.name}
                  </Text>

                  <Text style={styles.centerMeta}>
                    {nearest_center.distance_km} km
                    away · ~
                    {nearest_center.walk_minutes} min
                    walk
                  </Text>
                </View>


                <View style={styles.statusPill}>
                  <Text
                    style={styles.statusPillText}
                  >
                    {nearest_center.status === "open"
                      ? "OPEN"
                      : "CLOSED"}
                  </Text>
                </View>

              </View>


              {/* Occupancy */}

              <View style={styles.occupancyRow}>
                <Text style={styles.occupancyLabel}>
                  Occupancy
                </Text>

                <Text style={styles.occupancyLabel}>
                  {nearest_center.occupancy} /{" "}
                  {nearest_center.capacity}
                </Text>
              </View>


              <View style={styles.occupancyBar}>
                <View
                  style={[
                    styles.occupancyFill,
                    {
                      width: `${occupancyPct}%`,
                    },
                  ]}
                />
              </View>


              {/* Get directions */}

              <TouchableOpacity
                style={styles.directionsBtn}
                activeOpacity={0.8}
                onPress={() =>
                  navigation.navigate(
                    "EvacuationMap",
                    {
                      focusCenterId:
                        nearest_center.id,
                    }
                  )
                }
              >
                <PinIcon color="#fff" />

                <Text
                  style={styles.directionsBtnText}
                >
                  Get Directions
                </Text>
              </TouchableOpacity>

            </View>
          </View>

        </ScrollView>


        {/* ============================================= */}
        {/* BOTTOM NAVIGATION                             */}
        {/* ============================================= */}

        <BottomNav
          active={activeTab}
          onSelect={handleTabSelect}
        />

      </SafeAreaView>
    </MobileShell>
  );
}


// ======================================================
// STYLES
// ======================================================

const styles = StyleSheet.create({

  // ====================================================
  // ROOT
  // ====================================================

  loading: {
    flex: 1,

    alignItems: "center",
    justifyContent: "center",

    backgroundColor: "#f5f7fa",
  },


  screen: {
    flex: 1,

    width: "100%",

    backgroundColor: "#f5f7fa",
  },


  // ====================================================
  // HEADER
  // ====================================================

  header: {
    width: "100%",

    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",

    paddingHorizontal: 20,

    /*
      Small padding because SafeAreaView has
      already moved us below the iPhone notch.
    */
    paddingTop: 4,
    paddingBottom: 10,

    flexShrink: 0,
  },


  headerTextContainer: {
    flex: 1,
    minWidth: 0,
  },


  greeting: {
    fontSize: 13,
    lineHeight: 18,

    color: "#64748b",
  },


  householdName: {
    marginTop: 1,

    fontSize: 20,
    lineHeight: 25,

    fontWeight: "700",

    color: "#0f172a",
  },


  // ====================================================
  // SCROLL VIEW
  // ====================================================

  scrollView: {
    flex: 1,

    width: "100%",
  },


  body: {
    flexGrow: 1,

    paddingHorizontal: 20,

    paddingTop: 0,
    paddingBottom: 20,

    gap: 18,
  },


  // ====================================================
  // QUICK ACTIONS
  // ====================================================

  quickActions: {
    width: "100%",

    flexDirection: "row",

    gap: 10,
  },


  quickAction: {
    flex: 1,

    minWidth: 0,

    borderRadius: 12,

    paddingHorizontal: 10,
    paddingVertical: 12,

    alignItems: "center",
    justifyContent: "center",

    gap: 6,
  },


  qrAction: {
    backgroundColor: "#eaf0fb",
  },


  registrationAction: {
    backgroundColor: "#fdf1e3",
  },


  quickActionLabel: {
    width: "100%",

    fontSize: 12,
    lineHeight: 17,

    fontWeight: "600",

    color: "#374151",

    textAlign: "center",
  },


  // ====================================================
  // EMERGENCY CONTACTS
  // ====================================================

  emergencyContactsBtn: {
    width: "100%",

    flexDirection: "row",
    alignItems: "center",

    gap: 12,

    backgroundColor: "#fee2e2",

    borderRadius: 12,

    paddingHorizontal: 16,
    paddingVertical: 16,

    borderWidth: 1,
    borderColor: "#fecaca",
  },


  emergencyIconContainer: {
    alignItems: "center",
    justifyContent: "center",

    flexShrink: 0,
  },


  emergencyContactsText: {
    flex: 1,

    minWidth: 0,
  },


  emergencyContactsTitle: {
    fontSize: 15,
    lineHeight: 20,

    fontWeight: "700",

    color: "#b91c1c",
  },


  emergencyContactsSubtitle: {
    marginTop: 2,

    fontSize: 12,
    lineHeight: 17,

    color: "#dc2626",
  },


  // ====================================================
  // RELIEF DISTRIBUTION
  // ====================================================

  reliefAction: {
    width: "100%",

    backgroundColor: "#dbeafe",

    borderRadius: 12,

    paddingHorizontal: 16,
    paddingVertical: 16,

    borderWidth: 1,
    borderColor: "#bfdbfe",
  },


  reliefActionTitle: {
    fontSize: 15,
    lineHeight: 20,

    fontWeight: "700",

    color: "#1d4ed8",
  },


  reliefActionSubtitle: {
    marginTop: 2,

    fontSize: 12,
    lineHeight: 17,

    color: "#3b82f6",
  },


  // ====================================================
  // EVACUATION SECTION
  // ====================================================

  section: {
    width: "100%",
  },


  sectionLabel: {
    marginBottom: 8,

    fontSize: 13,
    lineHeight: 18,

    fontWeight: "700",

    color: "#374151",
  },


  centerPanel: {
    width: "100%",

    backgroundColor: "#ffffff",

    borderRadius: 14,

    padding: 14,

    borderWidth: 1,
    borderColor: "#eef0f3",
  },


  centerTop: {
    width: "100%",

    flexDirection: "row",

    justifyContent: "space-between",
    alignItems: "flex-start",

    gap: 10,
  },


  centerInfo: {
    flex: 1,

    minWidth: 0,
  },


  centerName: {
    fontSize: 15,
    lineHeight: 20,

    fontWeight: "700",

    color: "#0f172a",
  },


  centerMeta: {
    marginTop: 2,

    fontSize: 12,
    lineHeight: 17,

    color: "#64748b",
  },


  // ====================================================
  // STATUS
  // ====================================================

  statusPill: {
    flexShrink: 0,

    backgroundColor: "#dcfce7",

    borderRadius: 12,

    paddingHorizontal: 10,
    paddingVertical: 4,
  },


  statusPillText: {
    fontSize: 12,
    lineHeight: 16,

    fontWeight: "700",

    color: "#15803d",
  },


  // ====================================================
  // OCCUPANCY
  // ====================================================

  occupancyRow: {
    width: "100%",

    flexDirection: "row",

    alignItems: "center",
    justifyContent: "space-between",

    marginTop: 14,
  },


  occupancyLabel: {
    fontSize: 12,
    lineHeight: 17,

    color: "#64748b",
  },


  occupancyBar: {
    width: "100%",

    height: 6,

    marginTop: 6,

    backgroundColor: "#eef0f3",

    borderRadius: 3,

    overflow: "hidden",
  },


  occupancyFill: {
    height: "100%",

    backgroundColor: "#2563eb",

    borderRadius: 3,
  },


  // ====================================================
  // DIRECTIONS
  // ====================================================

  directionsBtn: {
    width: "100%",

    flexDirection: "row",

    alignItems: "center",
    justifyContent: "center",

    gap: 6,

    marginTop: 14,

    backgroundColor: "#2563eb",

    borderRadius: 10,

    paddingHorizontal: 12,
    paddingVertical: 10,
  },


  directionsBtnText: {
    fontSize: 13,
    lineHeight: 18,

    fontWeight: "600",

    color: "#ffffff",
  },
});


export default HomeScreen;