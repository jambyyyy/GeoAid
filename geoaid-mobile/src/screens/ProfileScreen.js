import { useEffect, useState } from "react";

import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Image,
  ActivityIndicator,
} from "react-native";

import {
  SafeAreaView,
} from "react-native-safe-area-context";

import AsyncStorage from
  "@react-native-async-storage/async-storage";

import * as ImagePicker from "expo-image-picker";

import MobileShell from "../components/MobileShell";

import {
  BackIcon,
  EditIcon,
  CheckIcon,
  XIcon,
} from "../components/icons";

import { API_BASE } from "../api";


function ProfileScreen({ navigation }) {

  const [householdData, setHouseholdData] =
    useState(null);

  const [loading, setLoading] =
    useState(true);

  const [editing, setEditing] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [loadError, setLoadError] =
    useState("");

  const [
    uploadingMemberId,
    setUploadingMemberId,
  ] = useState(null);


  const [editForm, setEditForm] =
    useState({
      full_name: "",
      address_line: "",
      landmark: "",
      mobile_number: "",
    });


  // ==================================================
  // FETCH PROFILE
  // ==================================================

  const fetchProfile = async () => {

    setLoading(true);

    setLoadError("");


    const mobileNumber =
      await AsyncStorage.getItem(
        "geoaid_resident_mobile"
      );


    if (!mobileNumber) {

      setLoadError(
        "You're not signed in. Please log in again."
      );

      setLoading(false);

      return;
    }


    try {

      const response = await fetch(
        `${API_BASE}/api/resident/profile/?mobile_number=${encodeURIComponent(
          mobileNumber
        )}`
      );


      if (!response.ok) {

        setLoadError(
          `Couldn't load your profile (error ${response.status}).`
        );

        return;
      }


      const data =
        await response.json();


      setHouseholdData(data);


      setEditForm({

        full_name:
          data.full_name || "",

        address_line:
          data.address_line || "",

        landmark:
          data.landmark || "",

        mobile_number:
          data.mobile_number ||
          mobileNumber,

      });

    } catch (err) {

      console.error(
        "Failed to fetch profile:",
        err
      );


      setLoadError(
        "Unable to connect to the server."
      );

    } finally {

      setLoading(false);

    }
  };


  useEffect(() => {

    fetchProfile();

  }, []);


  // ==================================================
  // SAVE PROFILE
  // ==================================================

  const handleSave = async () => {

    setSaving(true);


    try {

      const mobileNumber =
        await AsyncStorage.getItem(
          "geoaid_resident_mobile"
        );


      const response =
        await fetch(
          `${API_BASE}/api/resident/profile/update/`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({

              mobile_number:
                mobileNumber,

              ...editForm,

            }),
          }
        );


      const data =
        await response
          .json()
          .catch(() => ({}));


      if (!response.ok) {

        Alert.alert(
          "Update Failed",

          data.message ||
            "Could not update profile. Please try again."
        );

        return;
      }


      setHouseholdData(data);

      setEditing(false);


      Alert.alert(
        "Success",
        "Profile updated successfully!"
      );

    } catch (err) {

      console.error(err);


      Alert.alert(
        "Error",
        "Unable to connect to the server."
      );

    } finally {

      setSaving(false);

    }
  };


  // ==================================================
  // CANCEL EDIT
  // ==================================================

  const handleCancel = () => {

    if (householdData) {

      setEditForm({

        full_name:
          householdData.full_name || "",

        address_line:
          householdData.address_line || "",

        landmark:
          householdData.landmark || "",

        mobile_number:
          householdData.mobile_number || "",

      });

    }


    setEditing(false);
  };


  // ==================================================
  // MEMBER INITIAL
  // ==================================================

  const getMemberInitial = (
    fullName
  ) => {

    if (!fullName) {
      return "?";
    }


    return fullName
      .trim()
      .charAt(0)
      .toUpperCase();
  };


  // ==================================================
  // SELECT MEMBER PROFILE IMAGE
  // ==================================================

  const pickMemberImage = async (
    member
  ) => {

    if (
      !member ||
      member.id === undefined ||
      member.id === null
    ) {

      Alert.alert(
        "Unable to Add Photo",
        "This family member does not have a valid member ID."
      );

      return;
    }


    try {

      const permission =
        await ImagePicker
          .requestMediaLibraryPermissionsAsync();


      if (!permission.granted) {

        Alert.alert(
          "Permission Required",
          "Please allow GeoAid to access your photos so you can select a profile picture."
        );

        return;
      }


      const result =
        await ImagePicker
          .launchImageLibraryAsync({

            mediaTypes: ["images"],

            allowsEditing: true,

            aspect: [1, 1],

            quality: 0.8,

          });


      if (result.canceled) {
        return;
      }


      if (
        !result.assets ||
        result.assets.length === 0
      ) {
        return;
      }


      const asset =
        result.assets[0];


      await uploadMemberImage(
        member,
        asset
      );

    } catch (err) {

      console.error(
        "Image picker error:",
        err
      );


      Alert.alert(
        "Error",
        "Unable to select the image."
      );

    }
  };


  // ==================================================
  // UPLOAD MEMBER IMAGE
  // ==================================================

  const uploadMemberImage = async (
    member,
    asset
  ) => {

    setUploadingMemberId(
      member.id
    );


    try {

      const mobileNumber =
        await AsyncStorage.getItem(
          "geoaid_resident_mobile"
        );


      if (!mobileNumber) {

        Alert.alert(
          "Session Error",
          "Please log in again."
        );

        return;
      }


      const formData =
        new FormData();


      formData.append(
        "mobile_number",
        mobileNumber
      );


      formData.append(
        "member_id",
        String(member.id)
      );


      // Determine a suitable file extension.

      let extension = "jpg";


      if (
        asset.mimeType ===
        "image/png"
      ) {
        extension = "png";
      }


      if (
        asset.mimeType ===
        "image/webp"
      ) {
        extension = "webp";
      }


      const filename =
        asset.fileName ||
        `member_${member.id}_${Date.now()}.${extension}`;


      const mimeType =
        asset.mimeType ||
        (extension === "png"
          ? "image/png"
          : extension === "webp"
          ? "image/webp"
          : "image/jpeg");


      formData.append(
        "image",
        {
          uri: asset.uri,

          name: filename,

          type: mimeType,
        }
      );


      const response =
        await fetch(
          `${API_BASE}/api/resident/profile/member-photo/`,
          {
            method: "POST",

            /*
              Do NOT manually set Content-Type here.

              React Native will automatically create
              the multipart/form-data boundary.
            */

            body: formData,
          }
        );


      const data =
        await response
          .json()
          .catch(() => ({}));


      if (!response.ok) {

        Alert.alert(
          "Upload Failed",

          data.message ||
            "Unable to upload the profile photo."
        );

        return;
      }


      // Update only this member locally so the
      // image appears immediately.

      setHouseholdData(
        (current) => {

          if (!current) {
            return current;
          }


          return {

            ...current,

            members:
              current.members?.map(
                (item) => {

                  if (
                    item.id ===
                    member.id
                  ) {

                    return {
                      ...item,

                      image:
                        data.image,
                    };
                  }


                  return item;
                }
              ) || [],

          };
        }
      );


      Alert.alert(
        "Photo Updated",
        `${member.full_name}'s profile photo was updated successfully.`
      );

    } catch (err) {

      console.error(
        "Photo upload error:",
        err
      );


      Alert.alert(
        "Upload Failed",
        "Unable to connect to the server."
      );

    } finally {

      setUploadingMemberId(
        null
      );

    }
  };


  // ==================================================
  // LOADING
  // ==================================================

  if (loading) {

    return (

      <MobileShell>

        <SafeAreaView
          style={styles.loading}
          edges={["top", "bottom"]}
        >

          <ActivityIndicator
            size="small"
            color="#2563eb"
          />

          <Text
            style={styles.loadingText}
          >
            Loading profile…
          </Text>

        </SafeAreaView>

      </MobileShell>
    );
  }


  // ==================================================
  // SCREEN
  // ==================================================

  return (

    <MobileShell>

      <SafeAreaView
        style={styles.screen}
        edges={["top"]}
      >

        {/* HEADER */}

        <View style={styles.header}>

          <TouchableOpacity
            style={styles.backBtn}
            onPress={() =>
              navigation.goBack()
            }
            accessibilityLabel="Back"
          >

            <BackIcon />

          </TouchableOpacity>


          <Text style={styles.title}>
            My Profile
          </Text>


          {!editing ? (

            <TouchableOpacity
              style={styles.editBtn}
              onPress={() =>
                setEditing(true)
              }
              accessibilityLabel="Edit Profile"
            >

              <EditIcon
                size={16}
                color="#2563eb"
              />

            </TouchableOpacity>

          ) : (

            <View
              style={
                styles.headerPlaceholder
              }
            />

          )}

        </View>


        {/* BODY */}

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={
            styles.body
          }
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={
            false
          }
        >

          {!householdData &&
          loadError ? (

            <View style={styles.errorCard}>

              <Text
                style={styles.errorText}
              >
                {loadError}
              </Text>


              <TouchableOpacity
                style={styles.retryBtn}
                onPress={fetchProfile}
              >

                <Text
                  style={
                    styles.retryBtnText
                  }
                >
                  Retry
                </Text>

              </TouchableOpacity>

            </View>

          ) : null}


          {householdData && (

            <>

              {/* HOUSEHOLD INFORMATION */}

              <View style={styles.section}>

                <Text
                  style={
                    styles.sectionLabel
                  }
                >
                  Household Information
                </Text>


                <View style={styles.infoCard}>

                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Household Code
                    </Text>

                    <Text
                      style={
                        styles.infoValue
                      }
                    >
                      {householdData.household_code ||
                        "—"}
                    </Text>

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Barangay
                    </Text>

                    <Text
                      style={
                        styles.infoValue
                      }
                    >
                      {householdData.barangay ||
                        "—"}
                    </Text>

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Purok
                    </Text>

                    <Text
                      style={
                        styles.infoValue
                      }
                    >
                      {householdData.purok ||
                        "—"}
                    </Text>

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Registration Status
                    </Text>


                    <View
                      style={[
                        styles.statusBadge,

                        householdData.status ===
                          "confirmed" &&
                          styles.statusConfirmed,

                        householdData.status ===
                          "approved" &&
                          styles.statusApproved,

                        householdData.status ===
                          "pending" &&
                          styles.statusPending,

                        householdData.status ===
                          "rejected" &&
                          styles.statusRejected,
                      ]}
                    >

                      <Text
                        style={
                          styles.statusText
                        }
                      >

                        {householdData.status ===
                        "confirmed"
                          ? "Confirmed"
                          : householdData.status ===
                            "approved"
                          ? "Approved"
                          : householdData.status ===
                            "pending"
                          ? "Pending"
                          : householdData.status ===
                            "rejected"
                          ? "Rejected"
                          : householdData.status}

                      </Text>

                    </View>

                  </View>

                </View>

              </View>


              {/* CONTACT INFORMATION */}

              <View style={styles.section}>

                <Text
                  style={
                    styles.sectionLabel
                  }
                >
                  Contact Information
                </Text>


                <View style={styles.infoCard}>

                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Full Name
                    </Text>


                    {editing ? (

                      <TextInput
                        style={
                          styles.editInput
                        }
                        value={
                          editForm.full_name
                        }
                        onChangeText={(v) =>
                          setEditForm(
                            (f) => ({
                              ...f,
                              full_name: v,
                            })
                          )
                        }
                        editable={!saving}
                        placeholder="Full name"
                      />

                    ) : (

                      <Text
                        style={
                          styles.infoValue
                        }
                      >
                        {householdData.full_name ||
                          "—"}
                      </Text>

                    )}

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Mobile Number
                    </Text>

                    <Text
                      style={
                        styles.infoValue
                      }
                    >
                      {householdData.mobile_number ||
                        "—"}
                    </Text>

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Address
                    </Text>


                    {editing ? (

                      <TextInput
                        style={
                          styles.editInput
                        }
                        value={
                          editForm.address_line
                        }
                        onChangeText={(v) =>
                          setEditForm(
                            (f) => ({
                              ...f,
                              address_line: v,
                            })
                          )
                        }
                        editable={!saving}
                        placeholder="Street / house no."
                      />

                    ) : (

                      <Text
                        style={
                          styles.infoValue
                        }
                      >
                        {householdData.address_line ||
                          "—"}
                      </Text>

                    )}

                  </View>


                  <View
                    style={styles.infoRow}
                  >

                    <Text
                      style={
                        styles.infoLabel
                      }
                    >
                      Landmark
                    </Text>


                    {editing ? (

                      <TextInput
                        style={
                          styles.editInput
                        }
                        value={
                          editForm.landmark
                        }
                        onChangeText={(v) =>
                          setEditForm(
                            (f) => ({
                              ...f,
                              landmark: v,
                            })
                          )
                        }
                        editable={!saving}
                        placeholder="Nearby landmark"
                      />

                    ) : (

                      <Text
                        style={
                          styles.infoValue
                        }
                      >
                        {householdData.landmark ||
                          "—"}
                      </Text>

                    )}

                  </View>

                </View>

              </View>


              {/* HOUSEHOLD MEMBERS */}

              <View style={styles.section}>

                <Text
                  style={
                    styles.sectionLabel
                  }
                >
                  Household Members (
                  {householdData.members
                    ?.length || 0}
                  )
                </Text>


                {householdData.members &&
                householdData.members.length >
                  0 ? (

                  <View
                    style={
                      styles.membersList
                    }
                  >

                    {householdData.members.map(
                      (
                        member,
                        index
                      ) => {

                        const uploading =
                          uploadingMemberId ===
                          member.id;


                        return (

                          <View
                            key={
                              member.id ||
                              index
                            }
                            style={
                              styles.memberCard
                            }
                          >

                            {/* PROFILE PHOTO */}

                            <TouchableOpacity
                              style={
                                styles.photoArea
                              }
                              activeOpacity={0.75}
                              disabled={
                                uploading
                              }
                              onPress={() =>
                                pickMemberImage(
                                  member
                                )
                              }
                            >

                              {member.image ? (

                                <Image
                                  source={{
                                    uri:
                                      member.image,
                                  }}
                                  style={
                                    styles.memberAvatar
                                  }
                                  resizeMode="cover"
                                />

                              ) : (

                                <View
                                  style={
                                    styles.memberAvatarPlaceholder
                                  }
                                >

                                  <Text
                                    style={
                                      styles.memberAvatarText
                                    }
                                  >
                                    {getMemberInitial(
                                      member.full_name
                                    )}
                                  </Text>

                                </View>

                              )}


                              {uploading && (

                                <View
                                  style={
                                    styles.uploadOverlay
                                  }
                                >

                                  <ActivityIndicator
                                    size="small"
                                    color="#ffffff"
                                  />

                                </View>

                              )}

                            </TouchableOpacity>


                            {/* MEMBER INFO */}

                            <View
                              style={
                                styles.memberInfo
                              }
                            >

                              <Text
                                style={
                                  styles.memberName
                                }
                              >
                                {
                                  member.full_name
                                }
                              </Text>


                              <Text
                                style={
                                  styles.memberRole
                                }
                              >
                                {
                                  member.relation
                                }
                              </Text>


                              <Text
                                style={
                                  styles.memberAge
                                }
                              >
                                Age:{" "}
                                {member.age}
                              </Text>


                              {/* ADD / CHANGE PHOTO */}

                              <TouchableOpacity
                                disabled={
                                  uploading
                                }
                                onPress={() =>
                                  pickMemberImage(
                                    member
                                  )
                                }
                                style={
                                  styles.photoButton
                                }
                              >

                                <Text
                                  style={
                                    styles.photoButtonText
                                  }
                                >
                                  {uploading
                                    ? "Uploading..."
                                    : member.image
                                    ? "Change Photo"
                                    : "Add Photo"}
                                </Text>

                              </TouchableOpacity>

                            </View>


                            {/* FLAGS */}

                            {member.flags &&
                              member.flags
                                .length >
                                0 && (

                              <View
                                style={
                                  styles.memberFlags
                                }
                              >

                                {member.flags.map(
                                  (
                                    flag,
                                    flagIndex
                                  ) => (

                                    <View
                                      key={
                                        flagIndex
                                      }
                                      style={
                                        styles.flagBadge
                                      }
                                    >

                                      <Text
                                        style={
                                          styles.flagText
                                        }
                                      >
                                        {flag}
                                      </Text>

                                    </View>

                                  )
                                )}

                              </View>

                            )}

                          </View>

                        );

                      }
                    )}

                  </View>

                ) : (

                  <View
                    style={
                      styles.emptyState
                    }
                  >

                    <Text
                      style={
                        styles.emptyText
                      }
                    >
                      No household members
                      added yet
                    </Text>

                  </View>

                )}

              </View>


              {/* EDIT ACTIONS */}

              {editing && (

                <View
                  style={
                    styles.editActions
                  }
                >

                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      styles.cancelBtn,
                    ]}
                    onPress={
                      handleCancel
                    }
                    disabled={saving}
                  >

                    <XIcon
                      color="#dc2626"
                    />

                    <Text
                      style={
                        styles.cancelBtnText
                      }
                    >
                      Cancel
                    </Text>

                  </TouchableOpacity>


                  <TouchableOpacity
                    style={[
                      styles.actionBtn,
                      styles.saveBtn,
                    ]}
                    onPress={
                      handleSave
                    }
                    disabled={saving}
                  >

                    <CheckIcon
                      color="#fff"
                    />

                    <Text
                      style={
                        styles.saveBtnText
                      }
                    >
                      {saving
                        ? "Saving..."
                        : "Save Changes"}
                    </Text>

                  </TouchableOpacity>

                </View>

              )}


              {!editing &&
                householdData.status !==
                  "confirmed" && (

                <View
                  style={
                    styles.infoNote
                  }
                >

                  <Text
                    style={
                      styles.infoNoteText
                    }
                  >
                    Note: Profile changes
                    may require
                    re-verification by your
                    Purok President.
                  </Text>

                </View>

              )}


              {/* LOG OUT */}

              <TouchableOpacity
                style={
                  styles.logoutBtn
                }
                onPress={async () => {

                  await AsyncStorage.removeItem(
                    "geoaid_resident_mobile"
                  );

                  navigation.replace(
                    "Login"
                  );

                }}
              >

                <Text
                  style={
                    styles.logoutBtnText
                  }
                >
                  Log Out
                </Text>

              </TouchableOpacity>

            </>

          )}

        </ScrollView>

      </SafeAreaView>

    </MobileShell>
  );
}


const styles = StyleSheet.create({

  loading: {
    flex: 1,

    alignItems: "center",
    justifyContent: "center",

    gap: 10,

    backgroundColor: "#f5f7fa",
  },


  loadingText: {
    fontSize: 13,

    color: "#64748b",
  },


  screen: {
    flex: 1,

    width: "100%",

    backgroundColor: "#f5f7fa",
  },


  scrollView: {
    flex: 1,
  },


  header: {
    flexDirection: "row",

    alignItems: "center",

    justifyContent:
      "space-between",

    gap: 12,

    paddingHorizontal: 20,

    paddingTop: 4,

    paddingBottom: 8,
  },


  backBtn: {
    padding: 8,

    borderRadius: 8,

    backgroundColor: "#fff",

    borderWidth: 1,

    borderColor: "#e5e7eb",
  },


  title: {
    fontSize: 17,

    fontWeight: "700",

    color: "#0f172a",
  },


  editBtn: {
    padding: 8,

    borderRadius: 8,

    backgroundColor: "#eaf3ff",
  },


  headerPlaceholder: {
    width: 34,

    height: 34,
  },


  body: {
    flexGrow: 1,

    paddingHorizontal: 20,

    paddingBottom: 32,

    gap: 18,
  },


  section: {
    width: "100%",
  },


  sectionLabel: {
    fontSize: 13,

    fontWeight: "700",

    color: "#374151",

    marginBottom: 8,
  },


  infoCard: {
    backgroundColor: "#fff",

    borderRadius: 12,

    padding: 16,

    borderWidth: 1,

    borderColor: "#eef0f3",

    gap: 12,
  },


  infoRow: {
    flexDirection: "row",

    justifyContent:
      "space-between",

    alignItems: "center",

    gap: 12,
  },


  infoLabel: {
    fontSize: 13,

    color: "#64748b",

    fontWeight: "500",
  },


  infoValue: {
    flexShrink: 1,

    fontSize: 14,

    fontWeight: "600",

    color: "#111827",

    textAlign: "right",
  },


  editInput: {
    flex: 1,

    marginLeft: 16,

    backgroundColor: "#f8fafc",

    borderRadius: 6,

    borderWidth: 1,

    borderColor: "#e2e8f0",

    paddingHorizontal: 10,

    paddingVertical: 6,

    fontSize: 14,

    fontWeight: "600",

    color: "#111827",

    textAlign: "right",
  },


  errorCard: {
    backgroundColor: "#fef2f2",

    borderWidth: 1,

    borderColor: "#fecaca",

    borderRadius: 12,

    padding: 16,

    alignItems: "center",

    gap: 10,
  },


  errorText: {
    fontSize: 13,

    color: "#991b1b",

    textAlign: "center",
  },


  retryBtn: {
    backgroundColor: "#dc2626",

    borderRadius: 8,

    paddingVertical: 10,

    paddingHorizontal: 20,
  },


  retryBtnText: {
    color: "#fff",

    fontWeight: "600",

    fontSize: 14,
  },


  statusBadge: {
    borderRadius: 8,

    paddingHorizontal: 10,

    paddingVertical: 4,
  },


  statusConfirmed: {
    backgroundColor: "#dcfce7",
  },


  statusApproved: {
    backgroundColor: "#dbeafe",
  },


  statusPending: {
    backgroundColor: "#fef3c7",
  },


  statusRejected: {
    backgroundColor: "#fee2e2",
  },


  statusText: {
    fontSize: 12,

    fontWeight: "700",

    color: "#111827",
  },


  membersList: {
    gap: 8,
  },


  memberCard: {
    width: "100%",

    flexDirection: "row",

    alignItems: "center",

    gap: 12,

    backgroundColor: "#fff",

    borderRadius: 12,

    padding: 12,

    borderWidth: 1,

    borderColor: "#eef0f3",
  },


  photoArea: {
    position: "relative",

    width: 58,

    height: 58,

    flexShrink: 0,
  },


  memberAvatar: {
    width: 58,

    height: 58,

    borderRadius: 29,

    backgroundColor: "#e5e7eb",

    borderWidth: 2,

    borderColor: "#dbeafe",
  },


  memberAvatarPlaceholder: {
    width: 58,

    height: 58,

    borderRadius: 29,

    backgroundColor: "#eaf3ff",

    borderWidth: 2,

    borderColor: "#bfdbfe",

    alignItems: "center",

    justifyContent: "center",
  },


  memberAvatarText: {
    fontSize: 21,

    fontWeight: "700",

    color: "#2563eb",
  },


  uploadOverlay: {
    position: "absolute",

    top: 0,
    right: 0,
    bottom: 0,
    left: 0,

    borderRadius: 29,

    backgroundColor:
      "rgba(15, 23, 42, 0.55)",

    alignItems: "center",

    justifyContent: "center",
  },


  memberInfo: {
    flex: 1,

    minWidth: 0,
  },


  memberName: {
    fontWeight: "600",

    fontSize: 14,

    color: "#111827",
  },


  memberRole: {
    marginTop: 1,

    fontSize: 12,

    color: "#64748b",
  },


  memberAge: {
    marginTop: 2,

    fontSize: 11,

    color: "#9ca3af",
  },


  photoButton: {
    alignSelf: "flex-start",

    marginTop: 6,

    paddingVertical: 3,

    paddingHorizontal: 8,

    borderRadius: 6,

    backgroundColor: "#eff6ff",
  },


  photoButtonText: {
    fontSize: 11,

    fontWeight: "700",

    color: "#2563eb",
  },


  memberFlags: {
    flexDirection: "row",

    flexWrap: "wrap",

    justifyContent: "flex-end",

    gap: 4,

    maxWidth: "30%",
  },


  flagBadge: {
    backgroundColor: "#eaf3ff",

    borderRadius: 6,

    paddingHorizontal: 6,

    paddingVertical: 2,
  },


  flagText: {
    fontSize: 10,

    fontWeight: "700",

    color: "#2563eb",
  },


  emptyState: {
    backgroundColor: "#fff",

    borderRadius: 12,

    padding: 16,

    borderWidth: 1,

    borderColor: "#eef0f3",

    alignItems: "center",
  },


  emptyText: {
    fontSize: 13,

    color: "#64748b",
  },


  editActions: {
    flexDirection: "row",

    gap: 12,

    marginTop: 8,
  },


  actionBtn: {
    flex: 1,

    flexDirection: "row",

    alignItems: "center",

    justifyContent: "center",

    gap: 8,

    borderRadius: 8,

    paddingVertical: 12,
  },


  cancelBtn: {
    backgroundColor: "#fff",

    borderWidth: 1,

    borderColor: "#d1d5db",
  },


  cancelBtnText: {
    color: "#dc2626",

    fontWeight: "600",

    fontSize: 14,
  },


  saveBtn: {
    backgroundColor: "#2563eb",
  },


  saveBtnText: {
    color: "#fff",

    fontWeight: "600",

    fontSize: 14,
  },


  infoNote: {
    backgroundColor: "#fff7ed",

    borderRadius: 8,

    padding: 12,

    borderWidth: 1,

    borderColor: "#fed7aa",
  },


  infoNoteText: {
    fontSize: 12,

    color: "#9a3412",

    textAlign: "center",
  },


  logoutBtn: {
    backgroundColor: "#dc2626",

    borderRadius: 8,

    paddingVertical: 14,

    alignItems: "center",

    marginTop: 8,
  },


  logoutBtnText: {
    color: "#fff",

    fontWeight: "700",

    fontSize: 14,
  },

});


export default ProfileScreen;