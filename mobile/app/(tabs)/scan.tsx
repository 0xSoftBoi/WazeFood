import { useCallback, useRef, useState } from "react";
import { Platform, TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Button, Card, Screen, Text, useTheme } from "../../src/ui";
import { useSession } from "../../src/session";

export default function ScanScreen() {
  const t = useTheme();
  const router = useRouter();
  const { api } = useSession();
  const [permission, requestPermission] = useCameraPermissions();
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const lock = useRef(false);

  useFocusEffect(useCallback(() => { lock.current = false; setActive(true); setStatus(null); return () => setActive(false); }, []));

  // Resolve a barcode (exact UPC) or a name (search), then jump to the product.
  const lookup = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (q.length === 0 || lock.current) return;
    setStatus(`Looking up "${q}"…`);
    try {
      if (/^[0-9]{6,}$/.test(q)) {
        const m = await api.resolve({ barcode: q });
        if (m.productId != null) return go(m.productId);
        setStatus(`No product for barcode ${q}. Try a name like "gatorade".`);
      } else {
        const r = await api.search(q);
        const hit = r.results[0];
        if (hit != null) return go(hit.id, hit.name);
        setStatus(`No match for "${q}". Try "gatorade", "milk", or "coke".`);
      }
    } catch {
      setStatus("Lookup failed — is the API running?");
    }
    function go(id: string, name?: string) {
      lock.current = true;
      router.push({ pathname: "/product/[id]", params: name != null ? { id, name } : { id } });
      setTimeout(() => { lock.current = false; setStatus(null); }, 700);
    }
  }, [api, router]);

  const onScan = useCallback((result: BarcodeScanningResult) => {
    if (lock.current) return;
    if (Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    void lookup(result.data);
  }, [lookup]);

  // Snap/upload any product photo → Gemini Vision identifies it → resolve to the catalog.
  const identifyByPhoto = useCallback(async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.5, mediaTypes: "images" });
    const asset = res.canceled ? undefined : res.assets[0];
    if (asset?.base64 == null) return;
    setStatus("Identifying your photo with AI…");
    try {
      const out = await api.identifyPhoto({ base64: asset.base64, mediaType: asset.mimeType ?? "image/jpeg" });
      if (out.product != null) {
        lock.current = true;
        const p = out.product;
        router.push({ pathname: "/product/[id]", params: { id: p.id, name: p.name, brand: p.brand ?? "", image: p.imageUrl ?? "", category: p.category } });
        setTimeout(() => { lock.current = false; setStatus(null); }, 700);
      } else {
        setStatus(out.text != null ? `Saw "${out.text}" — not in the catalog yet.` : "Couldn't identify that photo.");
      }
    } catch {
      setStatus("Identify failed — try again.");
    }
  }, [api, router]);

  const cameraOn = permission?.granted === true && active;

  return (
    <Screen>
      <Text variant="largeTitle" style={{ paddingVertical: t.spacing.base }}>Scan</Text>

      {cameraOn ? (
        <View style={{ height: 300, borderRadius: t.radius.lg, overflow: "hidden", backgroundColor: "#000", marginBottom: t.spacing.base }}>
          <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "qr"] }} onBarcodeScanned={onScan} />
          <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }} pointerEvents="none">
            <View style={{ width: 220, height: 130, borderRadius: t.radius.lg, borderWidth: 3, borderColor: "rgba(255,255,255,0.9)" }} />
          </View>
        </View>
      ) : (
        <Card onPress={() => void requestPermission()} elevation="sm" style={{ marginBottom: t.spacing.base, alignItems: "center", paddingVertical: t.spacing.xl }}>
          <Ionicons name="camera-outline" size={28} color={t.colors.textSecondary} />
          <Text variant="subhead" tone="secondary" style={{ marginTop: 6 }}>Tap to enable the camera</Text>
        </Card>
      )}

      <Button
        title="Snap a photo to identify"
        left={<Ionicons name="sparkles" size={18} color={t.colors.onPrimary} />}
        onPress={() => void identifyByPhoto()}
        fullWidth
        style={{ marginBottom: t.spacing.sm }}
      />
      <Text variant="footnote" tone="tertiary" style={{ marginBottom: t.spacing.lg }}>
        Take or upload a photo of any product — AI identifies it and finds the best nearby price.
      </Text>

      <Text variant="footnote" tone="secondary" style={{ marginBottom: t.spacing.sm }}>OR LOOK UP BY NAME / BARCODE</Text>
      <Card elevation="sm">
        <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
          <Ionicons name="search" size={20} color={t.colors.textTertiary} />
          <TextInput
            value={manual}
            onChangeText={setManual}
            placeholder='Barcode or name — try "gatorade"'
            placeholderTextColor={t.colors.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={() => void lookup(manual)}
            style={{ flex: 1, fontSize: 17, color: t.colors.textPrimary, paddingVertical: 0 }}
          />
        </View>
      </Card>
      <Button title="Look up" left={<Ionicons name="pricetag" size={18} color={t.colors.onPrimary} />} onPress={() => void lookup(manual)} fullWidth style={{ marginTop: t.spacing.md }} />

      {status != null && <Text variant="subhead" tone="secondary" style={{ marginTop: t.spacing.base }}>{status}</Text>}
    </Screen>
  );
}
