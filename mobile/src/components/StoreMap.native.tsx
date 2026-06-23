// Native map (iOS = Apple Maps, no API key; Android = Google Maps, needs a key — see app.json).
// Metro picks this file on iOS/Android; the .web.tsx sibling renders a fallback so the web bundle
// never imports react-native-maps.

import { View } from "react-native";
import MapView, { Marker, PROVIDER_DEFAULT } from "react-native-maps";
import { useTheme } from "../ui";
import type { StoreNear } from "../api/client";

export type StoreMapProps = {
  center: { lat: number; lng: number };
  stores: StoreNear[];
  height?: number;
  onSelectStore?: (id: string) => void;
};

export function StoreMap({ center, stores, height = 340, onSelectStore }: StoreMapProps) {
  const t = useTheme();
  return (
    <View style={{ height, borderRadius: t.radius.lg, overflow: "hidden" }}>
      <MapView
        style={{ flex: 1 }}
        provider={PROVIDER_DEFAULT}
        showsUserLocation
        showsMyLocationButton={false}
        initialRegion={{ latitude: center.lat, longitude: center.lng, latitudeDelta: 0.08, longitudeDelta: 0.08 }}
      >
        {stores.map((s) => (
          <Marker
            key={s.id}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={s.name}
            description={`${(s.distanceMeters / 1000).toFixed(1)} km away`}
            pinColor={t.colors.primary}
            onCalloutPress={() => onSelectStore?.(s.id)}
          />
        ))}
      </MapView>
    </View>
  );
}
