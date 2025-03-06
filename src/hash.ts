// See https://github.com/garycourt/murmurhash-js
function murmurHash2(str: string, seed = 0) {
  let l = str.length
  let h = seed ^ l
  let i = 0
  let k

  while (l >= 4) {
    k
            = ((str.charCodeAt(i) & 0xFF))
              | ((str.charCodeAt(++i) & 0xFF) << 8)
              | ((str.charCodeAt(++i) & 0xFF) << 16)
              | ((str.charCodeAt(++i) & 0xFF) << 24)
    k = (((k & 0xFFFF) * 0x5BD1E995) + ((((k >>> 16) * 0x5BD1E995) & 0xFFFF) << 16))
    k ^= k >>> 24
    k = (((k & 0xFFFF) * 0x5BD1E995) + ((((k >>> 16) * 0x5BD1E995) & 0xFFFF) << 16))

    h = (((h & 0xFFFF) * 0x5BD1E995) + ((((h >>> 16) * 0x5BD1E995) & 0xFFFF) << 16)) ^ k

    l -= 4
    ++i
  }

  /* eslint-disable no-fallthrough */
  switch (l) {
    case 3:
      h ^= (str.charCodeAt(i + 2) & 0xFF) << 16
    case 2:
      h ^= (str.charCodeAt(i + 1) & 0xFF) << 8
    case 1:
      h ^= (str.charCodeAt(i) & 0xFF)
      h = (((h & 0xFFFF) * 0x5BD1E995) + ((((h >>> 16) * 0x5BD1E995) & 0xFFFF) << 16))
  }

  h ^= h >>> 13
  h = (((h & 0xFFFF) * 0x5BD1E995) + ((((h >>> 16) * 0x5BD1E995) & 0xFFFF) << 16))
  h ^= h >>> 15

  return h >>> 0
}

export const hashFunc = murmurHash2
