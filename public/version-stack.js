export function fileVersions(item) {
  return item?.versionStack?.versions || [];
}

// A version stack stands on one sheet per other version, at most three (depth.css data-sheets).
export function versionSheets(item) {
  return Math.max(0, Math.min(3, fileVersions(item).length - 1));
}

export function fileVersion(item, id = item?.versionStack?.defaultId) {
  return fileVersions(item).find(version => version.id === id) || null;
}

export function nearbyFileVersions(item, id) {
  const versions = fileVersions(item);
  const index = versions.findIndex(version => version.id === id);
  return index < 0
    ? { previous: null, next: fileVersion(item) }
    : { previous: versions[index - 1], next: versions[index + 1] };
}

export function modifiedTime(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.valueOf())) return null;
  return {
    short: date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    exact: date.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" }),
  };
}
