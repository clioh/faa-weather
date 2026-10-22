/**
 * Photo manager for the photo-frame widget. Photos are stored on the mirror
 * (/api/photos), so uploads and deletes take effect immediately.
 *
 * Each photo is downscaled on the phone before upload (long edge at most
 * MAX_EDGE px, re-encoded as JPEG), so a 48 MP original becomes a few hundred
 * KB instead of many MB. The mirror is at most 1920 px on its long side; the
 * extra headroom keeps photos sharp when the frame crops them to fill a tile.
 *
 * Uploads go one at a time: the Pi is on home Wi-Fi and parallel multi-MB
 * uploads mostly just make each one slower and more likely to time out.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { api, type MirrorPhoto } from '@/lib/api';
import { colors, spacing, borderRadius, typography } from '@/lib/theme';
import { InlineError } from '../ErrorToast';
import { TOUCH } from './fieldStyles';

const MAX_BYTES = 10 * 1024 * 1024; // backend limit
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_EDGE = 2560;
const JPEG_QUALITY = 0.82;

/**
 * Downscale (never upscale) to MAX_EDGE on the long side and re-encode as
 * JPEG. Re-encoding also bakes in EXIF orientation and turns PNG/WebP
 * screenshots into compact JPEGs.
 */
async function prepareForUpload(asset: ImagePicker.ImagePickerAsset): Promise<{ uri: string; mime: string }> {
  const context = ImageManipulator.manipulate(asset.uri);
  const { width, height } = asset;
  if (width > 0 && height > 0 && Math.max(width, height) > MAX_EDGE) {
    context.resize(width >= height ? { width: MAX_EDGE } : { height: MAX_EDGE });
  }
  const image = await context.renderAsync();
  const result = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri, mime: 'image/jpeg' };
}

export function PhotoManager() {
  const [photos, setPhotos] = useState<MirrorPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPhotos(await api.getPhotos());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t load photos: ${e.message}` : 'Couldn’t load photos');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const pickAndUpload = async () => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPermissionDenied(true);
      return;
    }
    setPermissionDenied(false);

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: 20,
      // Full quality here; prepareForUpload resizes and compresses once.
      quality: 1,
      exif: false,
      // Ask iOS for JPEG instead of HEIC, which the mirror can't decode.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || result.assets.length === 0) return;

    const assets = result.assets;
    let failed = 0;
    let tooLarge = 0;
    setProgress({ done: 0, total: assets.length });
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      let file: { uri: string; mime: string } | null = null;
      try {
        file = await prepareForUpload(asset);
      } catch {
        // Resizing failed (unusual format, low memory): send the original
        // if the mirror will accept it as-is.
        const mime = asset.mimeType && ACCEPTED.includes(asset.mimeType) ? asset.mimeType : 'image/jpeg';
        if (asset.fileSize && asset.fileSize > MAX_BYTES) tooLarge++;
        else file = { uri: asset.uri, mime };
      }
      if (file) {
        try {
          const photo = await api.uploadPhoto(file.uri, file.mime);
          setPhotos((prev) => [...prev, photo]);
        } catch {
          failed++;
        }
      }
      setProgress({ done: i + 1, total: assets.length });
    }
    setProgress(null);

    const problems: string[] = [];
    if (tooLarge) problems.push(`${tooLarge} over 10 MB skipped`);
    if (failed) problems.push(`${failed} failed to upload`);
    if (problems.length) {
      setError(`${problems.join(', ')}.`);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  };

  const remove = async (photo: MirrorPhoto) => {
    setDeletingId(photo.id);
    try {
      await api.deletePhoto(photo.id);
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setConfirmingId(null);
    } catch (e) {
      setError(e instanceof Error ? `Couldn’t delete photo: ${e.message}` : 'Couldn’t delete photo');
    } finally {
      setDeletingId(null);
    }
  };

  const uploading = progress !== null;

  return (
    <View>
      {error && (
        <View style={styles.messageWrap}>
          <InlineError message={error} onDismiss={() => setError(null)} />
        </View>
      )}
      {permissionDenied && (
        <View style={styles.permission}>
          <Text style={styles.permissionText}>
            SkyGlass needs access to your photo library to add photos.
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={() => Linking.openSettings()}
            accessibilityRole="button"
          >
            <Text style={styles.permissionButtonText}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={styles.loader} />
      ) : (
        <>
          <Text style={styles.count}>
            {photos.length === 0
              ? 'No photos on the mirror yet.'
              : `${photos.length} photo${photos.length === 1 ? '' : 's'} · tap one to delete it`}
          </Text>
          <View style={styles.grid}>
            {photos.map((photo, index) => {
              const confirming = confirmingId === photo.id;
              return (
                <View key={photo.id} style={styles.cell}>
                  <TouchableOpacity
                    style={styles.thumbWrap}
                    activeOpacity={0.8}
                    onPress={() => setConfirmingId(confirming ? null : photo.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Photo ${index + 1}`}
                    accessibilityHint={confirming ? 'Hides the delete option' : 'Shows a delete option'}
                  >
                    <Image source={api.photoSource(photo)} style={styles.thumb} resizeMode="cover" />
                    {confirming && (
                      <View style={styles.confirmOverlay}>
                        {deletingId === photo.id ? (
                          <ActivityIndicator color={colors.text} />
                        ) : (
                          <TouchableOpacity
                            style={styles.deleteButton}
                            onPress={() => remove(photo)}
                            accessibilityRole="button"
                            accessibilityLabel={`Delete photo ${index + 1}`}
                          >
                            <Ionicons name="trash" size={16} color={colors.text} />
                            <Text style={styles.deleteText}>Delete</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              );
            })}
            {uploading &&
              Array.from({ length: progress.total - progress.done }).map((_, i) => (
                <View key={`pending-${i}`} style={styles.cell}>
                  <View style={[styles.thumbWrap, styles.pending]}>
                    {i === 0 ? <ActivityIndicator color={colors.primary} /> : null}
                  </View>
                </View>
              ))}
          </View>
        </>
      )}

      <TouchableOpacity
        style={[styles.addButton, uploading && styles.addButtonBusy]}
        onPress={pickAndUpload}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel="Add photos from your library"
      >
        <Ionicons name={uploading ? 'cloud-upload-outline' : 'add'} size={20} color={colors.primary} />
        <Text style={styles.addText}>
          {uploading ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Add photos'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const GAP = 6;

const styles = StyleSheet.create({
  messageWrap: { marginBottom: spacing.sm },
  loader: { paddingVertical: spacing.lg },
  count: { ...typography.caption, color: colors.textMuted, marginBottom: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -GAP / 2 },
  cell: { width: '33.333%', padding: GAP / 2 },
  thumbWrap: {
    aspectRatio: 1,
    borderRadius: borderRadius.sm,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },
  thumb: { width: '100%', height: '100%' },
  pending: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  confirmOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    minHeight: TOUCH - 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.error,
  },
  deleteText: { ...typography.bodySmall, fontWeight: '600', color: colors.text },
  addButton: {
    marginTop: spacing.md,
    minHeight: TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.borderFocus,
    backgroundColor: colors.primaryMuted,
  },
  addButtonBusy: { opacity: 0.7 },
  addText: { ...typography.body, fontWeight: '600', color: colors.primary },
  permission: {
    padding: spacing.md,
    borderRadius: borderRadius.md,
    backgroundColor: 'rgba(255, 170, 0, 0.1)',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  permissionText: { ...typography.bodySmall, color: colors.warning },
  permissionButton: { minHeight: TOUCH, justifyContent: 'center', alignSelf: 'flex-start' },
  permissionButtonText: { ...typography.body, fontWeight: '600', color: colors.primary },
});
