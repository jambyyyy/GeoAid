import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import RegisterScreen from "./src/screens/register/RegisterScreen";
import LoginScreen from "./src/screens/LoginScreen";
import HomeScreen from "./src/screens/HomeScreen";
import QRCodeScreen from "./qr-code/QRCodeScreen";
import StaffLoginScreen from "./staff/StaffLoginScreen";
import StaffDashboardScreen from "./staff/StaffDashboardScreen";
import ScannerScreen from "./staff/ScannerScreen";

const Stack = createNativeStackNavigator();

// Residents land on Login first. New residents use the "Create account"
// link on that screen to reach Register (see the back-button link
// inside RegisterScreen for the reverse path).
// Barangay Evacuation Staff use a separate stack entered via
// LoginScreen's "Barangay staff? Sign in here" link — see StaffLoginScreen.
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Login" screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Register" component={RegisterScreen} />
        <Stack.Screen name="Login" component={LoginScreen} />
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="QRCode" component={QRCodeScreen} />

        <Stack.Screen name="StaffLogin" component={StaffLoginScreen} />
        <Stack.Screen name="StaffDashboard" component={StaffDashboardScreen} />
        <Stack.Screen name="Scanner" component={ScannerScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}