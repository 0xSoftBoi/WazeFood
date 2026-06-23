import { useCallback, useRef, useState } from "react";
import { Platform, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Button, Card, EmptyState, Screen, Text, useTheme } from "../../src/ui";
import { useSession } from "../../src/session";

export default function ScanScreen() {
  const t = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const lock = useRef(false);

  // Re-arm the scanner each time the tab regains focus.
  useFocusEffect(useCallback(() => { lock.current = false; setActive(true); setStatus(null); return () => setActive(false); }, []));

  const onScan = useCallback(
    async (result: BarcodeScanningResult) => {
      if (lock.current) return;
      lock.current = true;
      if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatus(`Looking up ${result.data}…`);
      try {
        const match = await api.resolve({ barcode: result.data });
        if (match.productId != null) {
          router.push({ pathname: "/product/[id]", params: { id: match.productId } });
        } else {
          setStatus(`No match for ${result.data}. Try another item.`);
          setTimeout(() => { lock.current = false; setStatus(null); }, 1800);
        }
      } catch {
        setStatus("Lookup failed — try again.");
        setTimeout(() => { lock.current = false; setStatus(null); }, 1800);
      }
    },
    [api, router],
  );

  if (permission == null) return <Screen><View /></Screen>;

  if (!permission.granted) {
    return (
      <Screen>
        <Text variant="largeTitle" style={{ paddingVertical: t.spacing.base }}>Scan</Text>
        <EmptyState
          icon="barcode-outline"
          title="Scan a barcode"
          subtitle="Point your camera at a product barcode to look up its best nearby price."
          action={<Button title="Enable camera" onPress={requestPermission} />}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        {active && (
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "qr"] }}
            onBarcodeScanned={onScan}
          />
        )}
        {/* Reticle + hint overlay */}
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
          <View style={{ width: 240, height: 150, borderRadius: t.radius.lg, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" }} />
        </View>
        <View style={{ position: "absolute", bottom: t.spacing.xl, left: t.spacing.base, right: t.spacing.base }}>
          <Card elevation="lg">
            <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
              <Ionicons name={status != null ? "search" : "barcode-outline"} size={20} color={t.colors.primary} />
              <Text variant="callout" weight="600">{status ?? "Point at a barcode to look it up"}</Text>
            </View>
          </Card>
        </View>
      </View>
    </Screen>
  );
}
