# Configurable Archive File Location

## Overview
This feature adds the ability to configure the download history archive file location via YAML configuration.

**Addresses:** [Issue #1090](https://github.com/anidl/multi-downloader-nx/issues/1090) - Request for multiple archive files and custom locations.

## Changes Made

### 1. **Configuration Type Updates** (`modules/module.cfg-loader.ts`)
- Added `archive?: string` to the `ConfigObject.dir` type
- Allows optional configuration of archive file location

### 2. **Archive File Resolution** (`modules/module.downloadArchive.ts`)
- Implemented `getArchiveFile()` function to dynamically resolve archive location
- Supports both **absolute** and **relative** paths
- Falls back to default `./config/archive.json` if not configured

### 3. **Configuration File** (`config/dir-path.yml`)
- Added commented example showing how to configure archive location
- Documents the new optional `archive` configuration option

## Usage

### Default Behavior
If no configuration is provided, the archive file defaults to:
```
./config/archive.json
```

### Custom Configuration
Edit `config/dir-path.yml` (or `config/dir-path.user.yml`):

```yaml
content: ./videos/
fonts: ./fonts/
archive: ./my-custom-location/download-history.json
```

### Examples

**Relative path (recommended):**
```yaml
archive: ./config/archive.json          # Default location
archive: ./backups/archive.json         # Custom subdirectory
archive: ../shared-archive.json         # Parent directory
```

**Absolute path:**
```yaml
archive: C:/Users/YourName/Documents/anidl-archive.json   # Windows
archive: /home/username/archives/anidl.json               # Linux/Mac
```

**Rename the file:**
```yaml
archive: ./config/download-history.json
archive: ./config/my-archive.json
```

## Benefits

1. **Flexibility** - Users can now customize where download history is stored
2. **Organization** - Can separate archive from other config files
3. **Backup** - Can point to a backed-up or synced location
4. **Multiple Instances** - Can use different archives for different use cases (addresses #1090)
5. **Rename** - Can use a more descriptive filename

## Use Case: Multiple Archive Files (Issue #1090)

As requested in [issue #1090](https://github.com/anidl/multi-downloader-nx/issues/1090), users can now maintain separate archive files for different purposes.

### Example Setup

**Scenario:** User wants separate archives for seasonal anime vs. long-running shows like One Piece.

**Solution:** Create multiple instances or use different config directories:

#### **Option 1: Multiple Executable Copies**
```
anidl-seasonal/
  ├── anidl.exe
  └── config/
      ├── dir-path.yml  (archive: ./config/seasonal-archive.json)
      └── seasonal-archive.json

anidl-onepiece/
  ├── anidl.exe
  └── config/
      ├── dir-path.yml  (archive: ./config/onepiece-archive.json)
      └── onepiece-archive.json
```

#### **Option 2: Shared Installation with Custom Configs**
```bash
# For seasonal anime (fast processing)
cd anidl-installation
# Edit config/dir-path.yml to set: archive: ./config/seasonal-archive.json
anidl.exe --downloadArchive

# For One Piece (long processing)
cd anidl-installation
# Edit config/dir-path.yml to set: archive: ./config/onepiece-archive.json
anidl.exe --downloadArchive -s GRMG8ZQZR
```

#### **Option 3: User Config Override**
```bash
# Create config/dir-path.user.yml for temporary override
# This won't be overwritten on updates
```

**Benefits for this use case:**
- ✅ Separate archives prevent One Piece from slowing down seasonal downloads
- ✅ Can run `--downloadArchive` on different schedules
- ✅ Each archive tracks its own download history independently
- ✅ No manual archive editing needed

## Backward Compatibility

✅ **Fully backward compatible**
- If no `archive` configuration is set, defaults to `./config/archive.json`
- Existing installations continue to work without any changes
- No breaking changes to existing functionality

## Implementation Details

**Path Resolution:**
- Relative paths are resolved relative to `workingDir` (the application directory)
- Absolute paths are used as-is
- Uses Node.js `path.isAbsolute()` and `path.join()` for cross-platform compatibility

**Configuration Loading:**
- Loads config using existing `loadCfg()` function
- Follows existing configuration precedence (`.user.yml` overrides `.yml`)
- No performance impact - config loaded once at startup

## Testing Recommendations

1. **Default behavior** - Ensure existing archives work without configuration
2. **Relative paths** - Test various relative path configurations
3. **Absolute paths** - Test absolute paths on target platforms
4. **Invalid paths** - Verify graceful handling of invalid paths
5. **Cross-platform** - Test on Windows, Linux, and macOS

### CLI Override and Archive Commands

**`--archive <path>`** – Use a specific archive file for this run (overrides config). Enables different archives without changing config or using multiple copies:

```bash
# Seasonal archive
aniDL --archive ./config/seasonal-archive.json --downloadArchive --service crunchy

# One Piece only
aniDL --archive ./config/onepiece-archive.json --downloadArchive --service crunchy --srz GRMG8ZQZR
```

**`--removeArchive`** – Remove a series/season from the archive (use with `--service` and `-s` or `--srz`):

```bash
aniDL --service crunchy --srz GXXX --removeArchive
```

**`--archiveAddEpisodes <list>`** – Mark episodes as already in archive without downloading (e.g. `"1,2,3"` or `"1-5"`). Use with `--service` and `-s` or `--srz`. Add the series first with `--addArchive` if needed:

```bash
aniDL --service crunchy --srz GXXX --addArchive   # once
aniDL --service crunchy --srz GXXX --archiveAddEpisodes "1-12"
```

## Future Enhancements

Potential improvements for future PRs:
- Add archive file validation and error messages
- Support environment variable expansion in path
- Add archive migration/import tool

## Related Files

- `modules/module.cfg-loader.ts` - Configuration loading and types
- `modules/module.downloadArchive.ts` - Archive file operations
- `config/dir-path.yml` - Configuration file template

## Pull Request Ready

This branch is ready for a pull request to the upstream repository:
- ✅ Clean commit from latest `origin/master`
- ✅ Only contains this single feature
- ✅ TypeScript types updated
- ✅ Code formatted with Prettier
- ✅ No breaking changes
- ✅ Backward compatible
- ✅ Well documented

**Branch:** `feature/configurable-archive`  
**Base:** `origin/master` (latest)

