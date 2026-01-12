# Thumbnail Cache Implementation

## Overview
The PhotoRank application now includes on-the-fly thumbnail generation to solve memory issues when displaying folders with many images.

## How it works
1. **On-demand generation**: Thumbnails are only created when first requested
2. **Efficient caching**: Uses a two-level directory structure based on MD5 hash
3. **Optimized size**: Thumbnails are 160x160px JPEGs at 70% quality (~5-10KB each)
4. **Concurrent request handling**: Prevents duplicate generation for the same image

## Cache Structure
```
thumbnail-cache/
  aa/          # First 2 characters of MD5
    bb/        # Next 2 characters of MD5
      aabb...  # Thumbnail files (full MD5 hash + .jpg)
```
This structure ensures less than 100 images per leaf folder even with 1M+ images.

## Configuration
- `THUMBNAIL_CACHE_DIR`: Environment variable to set custom cache directory (default: `./thumbnail-cache`)
- Thumbnail size: 160x160 pixels
- Format: JPEG with 70% quality

## API Endpoint
- `GET /thumbnail/*`: Serves thumbnails, generating them if needed
- Example: `/thumbnail/sorted/4/folder/image.jpg`

## Implementation Details
- Uses Sharp library for fast image processing
- MD5 hash of the file path determines cache location
- Mutex pattern prevents duplicate generation
- Automatic cache directory creation
