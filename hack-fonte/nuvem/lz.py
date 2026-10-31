def lz77(r, a):
    assert r[a] == 0x10, hex(r[a])
    n = r[a+1] | r[a+2] << 8 | r[a+3] << 16
    out = bytearray(); i = a + 4
    while len(out) < n:
        f = r[i]; i += 1
        for b in range(8):
            if len(out) >= n: break
            if f & (0x80 >> b):
                x = r[i] << 8 | r[i+1]; i += 2
                l = (x >> 12) + 3; d = (x & 0xFFF) + 1
                for _ in range(l): out.append(out[-d])
            else:
                out.append(r[i]); i += 1
    return bytes(out[:n]), i - a
def lz77_raw(data):
    # "comprime" sem referências (só literais): válido para o descompressor do GBA
    out = bytearray([0x10, len(data) & 0xFF, len(data) >> 8 & 0xFF, len(data) >> 16])
    for k in range(0, len(data), 8):
        out.append(0); out += data[k:k+8]
    while len(out) % 4: out.append(0)
    return bytes(out)
