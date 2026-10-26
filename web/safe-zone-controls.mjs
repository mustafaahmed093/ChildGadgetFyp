const presets = new Set(['500', '1000', '2000', '3000', '5000']);

export function initializeSafeZoneControls({ getMap, getZones, onCenterSelected, onRadiusChange }) {
  const radius = document.getElementById('zone-radius');
  const preset = document.getElementById('zone-radius-preset');
  const locationButton = document.getElementById('zone-use-location');

  preset.addEventListener('change', () => {
    if (presets.has(preset.value)) radius.value = preset.value;
    radius.dispatchEvent(new Event('input', { bubbles: true }));
  });

  radius.addEventListener('input', () => {
    preset.value = presets.has(radius.value) ? radius.value : 'custom';
    onRadiusChange();
  });

  document.getElementById('zone-form').addEventListener('submit', event => {
    const lat = document.getElementById('zone-lat').value.trim();
    const lng = document.getElementById('zone-lng').value.trim();
    if (!lat || !lng || (Number(lat) === 0 && Number(lng) === 0)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      document.getElementById('zone-error').textContent = 'Choose a centre by clicking the map or using your current location.';
    }
  }, true);
  document.getElementById('zone-form').addEventListener('reset', () => {
    setTimeout(() => {
      preset.value = 'custom';
      document.getElementById('zone-selection-hint').textContent = 'No centre selected — click the map.';
      onRadiusChange();
    }, 0);
  });

  locationButton.addEventListener('click', () => {
    const error = document.getElementById('zone-error');
    error.textContent = '';
    if (!navigator.geolocation) {
      error.textContent = 'Location sharing is not available in this browser.';
      return;
    }
    locationButton.disabled = true;
    navigator.geolocation.getCurrentPosition(position => {
      const center = { lat: position.coords.latitude, lng: position.coords.longitude };
      onCenterSelected(center.lat, center.lng);
      getMap()?.setView([center.lat, center.lng], 16);
      document.getElementById('zone-selection-hint').textContent = 'Centre selected from your current location.';
      locationButton.disabled = false;
    }, geolocationError => {
      error.textContent = geolocationError.code === 1
        ? 'Location permission was denied. You can still click the map to choose a place.'
        : 'Could not get your current location. You can still click the map to choose a place.';
      locationButton.disabled = false;
    }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 });
  });

  document.body.addEventListener('click', event => {
    const edit = event.target.closest('[data-zone-edit]');
    if (!edit) return;
    const zone = getZones()[edit.dataset.zoneEdit];
    const lat = Number(zone?.lat ?? zone?.latitude);
    const lng = Number(zone?.lng ?? zone?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    onCenterSelected(lat, lng);
    getMap()?.setView([lat, lng], 16);
    document.getElementById('zone-selection-hint').textContent = 'Editing the saved centre — click the map to move it.';
    setTimeout(() => radius.dispatchEvent(new Event('input', { bubbles: true })), 0);
  }, true);
}
