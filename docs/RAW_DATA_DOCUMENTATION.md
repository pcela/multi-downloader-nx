# Raw Data Export Documentation

This document explains the `--raw` and `--rawoutput` functionality for exporting structured JSON data from all streaming services supported by multi-downloader-nx.

## Table of Contents

- [Overview](#overview)
- [Parameters](#parameters)
- [Usage Examples](#usage-examples)
- [JSON Structure](#json-structure)
- [Service-Specific Examples](#service-specific-examples)
- [Integration Guide](#integration-guide)

## Overview

The raw data export functionality allows you to extract structured episode metadata in JSON format from Crunchyroll, HIDIVE, and ADN without downloading video content. This is particularly useful for:

- RSS feed generation
- External API integrations
- Episode tracking systems
- Metadata collection for automation

## Parameters

### `--raw`
- **Type**: Boolean flag
- **Services**: All (Crunchyroll, HIDIVE, ADN)
- **Description**: Outputs raw JSON data to console
- **Usage**: `--raw`

### `--rawoutput`
- **Type**: String (file path)
- **Services**: All (Crunchyroll, HIDIVE, ADN)
- **Description**: Saves raw JSON data to specified file
- **Usage**: `--rawoutput path/to/output.json`

## Usage Examples

### Basic Raw Output (Console)

```bash
# Crunchyroll series
anidl --service crunchy --series GVDHX859Q --raw --silentAuth --username user@email.com --password "password"

# HIDIVE season
anidl --service hidive --s 31577 --raw --silentAuth --username user@email.com --password "password"

# ADN show
anidl --service adn --s 1307 --raw --silentAuth --username user --password "password"

```

### Raw Output to File

```bash
# Export Crunchyroll series to file
anidl --service crunchy --series GVDHX859Q --raw --rawoutput crunchyroll_data.json --silentAuth --username user@email.com --password "password"

# Export HIDIVE season to file
anidl --service hidive --s 31577 --raw --rawoutput hidive_data.json --silentAuth --username user@email.com --password "password"
```

### Episode Selection with Raw Output

```bash
# Export only specific episodes
anidl --service crunchy --series GVDHX859Q -e 1-3 --raw --rawoutput episodes_1_3.json --silentAuth --username user@email.com --password "password"

# Export all episodes except specific ones
anidl --service hidive --s 31577 --but 1,2 --raw --rawoutput hidive_except_1_2.json --silentAuth --username user@email.com --password "password"

# Export all episodes explicitly
anidl --service adn --s 1307 --all --raw --rawoutput adn_all_episodes.json --silentAuth --username user --password "password"
```

### Search Results Raw Output

```bash
# Export search results
anidl --service crunchy --search "New Saga" --raw --rawoutput search_results.json --silentAuth --username user@email.com --password "password"
```

## JSON Structure

### Root Structure

All raw JSON exports follow this consistent structure:

```json
{
  "service": "crunchy|hidive|adn",
  "dataType": "search|series|seasons|episodes|other",
  "timestamp": "2025-09-29T07:35:04.299Z",
  "description": "Human-readable description of the data",
  "data": {
    "isOk": true,
    "value": [
      // Array of episode objects
    ]
  }
}
```

### Episode Object Structure

Each episode in the `value` array contains:

```json
{
  "data": [
    {
      "mediaId": "string",
      "lang": {
        "name": "Japanese",
        "code": "jpn"
      },
      "versions": [...],
      "isSubbed": true,
      "isDubbed": true,
      "playback": "https://api.service.com/playback/url"
    }
  ],
  "seriesTitle": "Series Title",
  "seasonTitle": "Season Title", 
  "episodeNumber": "1",
  "episodeTitle": "Episode Title",
  "seasonID": "SEASON123",
  "season": 1,
  "showID": "SHOW123",
  "e": "1",
  "image": "https://image.url/thumbnail.jpg"
}
```

## Service-Specific Examples

### Crunchyroll Example

```json
{
  "service": "crunchy",
  "dataType": "series",
  "timestamp": "2025-09-29T07:35:04.299Z",
  "description": "Series GVDHX859Q data with episodes",
  "data": {
    "isOk": true,
    "value": [
      {
        "data": [
          {
            "mediaId": "GJWU2VKX3",
            "versions": [...],
            "isSubbed": true,
            "isDubbed": true,
            "lang": {
              "name": "Japanese",
              "code": "jpn"
            },
            "playback": "https://cr-play-service.prd.crunchyrollsvc.com/..."
          }
        ],
        "seriesTitle": "New Saga",
        "seasonTitle": "New Saga",
        "episodeNumber": "1",
        "episodeTitle": "I'll Change My Fate",
        "seasonID": "GR75CDJ0M",
        "season": 1,
        "showID": "GVDHX859Q",
        "e": "1",
        "image": "https://img1.ak.crunchyroll.com/..."
      }
    ]
  }
}
```

### HIDIVE Example

```json
{
  "service": "hidive",
  "dataType": "seasons",
  "timestamp": "2025-09-29T07:35:04.299Z",
  "description": "Season 31577 data with episodes",
  "data": {
    "isOk": true,
    "value": [
      {
        "data": [
          {
            "mediaId": "823880",
            "lang": null,
            "versions": null,
            "isSubbed": false,
            "isDubbed": false
          }
        ],
        "seriesTitle": "Bad Girl",
        "seasonTitle": "Bad Girl",
        "episodeNumber": "1",
        "episodeTitle": "As of Today, I'm a Bad Girl! / I Wanna Be a Bad Girl! / Dog Ears and a Collar",
        "seasonID": "31577",
        "season": 1,
        "showID": "31577",
        "e": "1",
        "image": "https://hidive.com/image/url"
      }
    ]
  }
}
```

### ADN Example

```json
{
  "service": "adn",
  "dataType": "series", 
  "timestamp": "2025-09-29T07:35:04.299Z",
  "description": "Show 1307 data with episodes",
  "data": {
    "isOk": true,
    "value": [
      {
        "data": [
          {
            "mediaId": "29293",
            "lang": {
              "name": "Japanese",
              "code": "jpn"
            },
            "versions": null,
            "isSubbed": false,
            "isDubbed": false
          }
        ],
        "seriesTitle": "Fermat Kitchen",
        "seasonTitle": "Fermat Kitchen",
        "episodeNumber": "1",
        "episodeTitle": "Un jeune homme mystérieux",
        "seasonID": "1307",
        "season": 1,
        "showID": "1307",
        "e": "1",
        "image": "https://image.url"
      }
    ]
  }
}
```


## Integration Guide

### RSS Feed Generation

For RSS feed generation, you can use the exported JSON data as follows:

1. **Extract episode metadata**:
   ```javascript
   const data = JSON.parse(rawJsonData);
   const episodes = data.data.value;
   
   episodes.forEach(episode => {
     const title = episode.episodeTitle;
     const description = `${episode.seriesTitle} - Season ${episode.season} Episode ${episode.episodeNumber}`;
     const mediaId = episode.data[0].mediaId;
     const thumbnail = episode.image;
     // Use for RSS item generation
   });
   ```

2. **Language filtering**:
   ```javascript
   const japaneseEpisodes = episodes.filter(ep => 
     ep.data.some(d => d.lang && d.lang.code === 'jpn')
   );
   ```

3. **Playback URL extraction**:
   ```javascript
   const playbackUrls = episodes.map(ep => ({
     episodeId: ep.data[0].mediaId,
     playbackUrl: ep.data[0].playback,
     language: ep.data[0].lang
   }));
   ```

### API Integration

For external API integrations:

1. **Episode tracking**:
   ```javascript
   const episodeData = {
     series: episode.seriesTitle,
     season: episode.season,
     episodeNumber: episode.episodeNumber,
     title: episode.episodeTitle,
     mediaId: episode.data[0].mediaId,
     service: data.service
   };
   ```

2. **Multi-language support**:
   ```javascript
   episode.data.forEach(variant => {
     if (variant.lang) {
       console.log(`Available in: ${variant.lang.name} (${variant.lang.code})`);
     }
   });
   ```

### Error Handling

Always check the `isOk` status:

```javascript
const data = JSON.parse(rawJsonData);
if (data.data.isOk && data.data.value.length > 0) {
  // Process episodes
  console.log(`Found ${data.data.value.length} episodes`);
} else {
  console.log('No episodes found or error occurred');
}
```

## Notes

- **Authentication**: Raw data export requires valid authentication for each service
- **Rate limiting**: Respect service rate limits when making multiple requests
- **Language defaults**: Default language is Japanese (`jpn`) unless specified otherwise
- **Empty results**: If no episodes match the language filter, `value` array will be empty
- **Episode selection**: Raw output respects `-e`, `--but`, and `--all` flags for episode filtering
- **File output**: Use `--rawoutput` for file output, `--raw` for console output (can be used together)

This raw data functionality provides a reliable way to extract episode metadata for external integrations while maintaining consistent JSON structure across all supported streaming services.
