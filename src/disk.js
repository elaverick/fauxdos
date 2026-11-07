/** FauxDOS disk-image format and host-side drive implementation. */
export const DISK_IMAGE_SIZE = 256 * 1024;
export const MAX_FILES = 24;
export const NAME_BYTES = 16;
export const DIRECTORY_RECORD_BYTES = 20;
export const FLAG_EXECUTABLE = 0x01;
export const FLAG_DIRECTORY = 0x02;
const MAGIC = new TextEncoder().encode("F6502DSK");
const VERSION = 1;
const HEADER_BYTES = 64;
const DIRECTORY_OFFSET = HEADER_BYTES;
const RECORD_BYTES = 32;
const DATA_OFFSET = 2048;

function asciiName(value) {
  const name = String(value ?? "").trim().toUpperCase();
  const parts = name.split("/");
  if (!name || name.length >= NAME_BYTES || parts.some(part =>
    !part || part === "." || part === ".." || !/^[A-Z0-9_.-]+$/.test(part))) {
    throw new Error("Names must be 1-15 characters: A-Z, 0-9, dot, dash, underscore and / separators");
  }
  return name;
}

function parentName(name) {
  const separator = name.lastIndexOf("/");
  return separator < 0 ? null : name.slice(0, separator);
}

function readCString(memory, pointer) {
  let out = "";
  for (let i = 0; i < 16; i += 1) {
    const c = memory[(pointer + i) & 0xffff];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

export class DiskImage {
  constructor(bytes) {
    if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
    const header = bytes.byteLength >= 22 ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
    if (bytes.byteLength !== DISK_IMAGE_SIZE || !MAGIC.every((v, i) => bytes[i] === v) || bytes[8] !== VERSION ||
        bytes[9] !== MAX_FILES || !header || header.getUint16(10, true) !== DIRECTORY_OFFSET ||
        header.getUint16(12, true) !== RECORD_BYTES || header.getUint32(14, true) !== DATA_OFFSET ||
        header.getUint32(18, true) !== DISK_IMAGE_SIZE) {
      throw new Error("Invalid FauxDOS disk image (expected a version 1, 256 KiB F6502DSK image)");
    }
    this.bytes = bytes.slice();
  }

  static format() {
    const bytes = new Uint8Array(DISK_IMAGE_SIZE);
    bytes.set(MAGIC, 0);
    bytes[8] = VERSION;
    bytes[9] = MAX_FILES;
    const dv = new DataView(bytes.buffer);
    dv.setUint16(10, DIRECTORY_OFFSET, true);
    dv.setUint16(12, RECORD_BYTES, true);
    dv.setUint32(14, DATA_OFFSET, true);
    dv.setUint32(18, DISK_IMAGE_SIZE, true);
    return new DiskImage(bytes);
  }

  static fromArrayBuffer(buffer) { return new DiskImage(new Uint8Array(buffer)); }

  get dataView() { return new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength); }

  entries() {
    const result = [];
    const dv = this.dataView;
    for (let i = 0; i < MAX_FILES; i += 1) {
      const p = DIRECTORY_OFFSET + i * RECORD_BYTES;
      if (this.bytes[p] === 0) continue;
      let name = "";
      for (let n = 0; n < NAME_BYTES && this.bytes[p + n]; n += 1) name += String.fromCharCode(this.bytes[p + n]);
      const offset = dv.getUint32(p + 16, true);
      const size = dv.getUint32(p + 20, true);
      if (!name || offset < DATA_OFFSET || offset + size > DISK_IMAGE_SIZE) continue;
      result.push({ name, offset, size, flags: this.bytes[p + 24] });
    }
    return result;
  }

  list() { return this.entries().sort((a, b) => a.name.localeCompare(b.name)); }

  readFile(filename) {
    const name = asciiName(filename);
    const entry = this.entries().find(e => e.name === name);
    if (!entry || (entry.flags & FLAG_DIRECTORY)) return null;
    return this.bytes.slice(entry.offset, entry.offset + entry.size);
  }

  _requireParentDirectory(name, entries) {
    const parent = parentName(name);
    if (parent && !entries.some(e => e.name === parent && (e.flags & FLAG_DIRECTORY))) {
      throw new Error("Parent directory does not exist");
    }
  }

  _replaceEntries(entries) {
    const next = new Uint8Array(DISK_IMAGE_SIZE);
    next.set(this.bytes.subarray(0, DATA_OFFSET));
    next.fill(0, DIRECTORY_OFFSET, DIRECTORY_OFFSET + MAX_FILES * RECORD_BYTES);
    const dv = new DataView(next.buffer);
    let cursor = DATA_OFFSET;
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let i = 0; i < entries.length; i += 1) {
      const item = entries[i];
      const isDirectory = !!(item.flags & FLAG_DIRECTORY);
      const data = isDirectory ? new Uint8Array(0) :
        (item.data ?? this.bytes.slice(item.offset, item.offset + item.size));
      if (cursor + data.length > DISK_IMAGE_SIZE) throw new Error("Disk full");
      const p = DIRECTORY_OFFSET + i * RECORD_BYTES;
      for (let n = 0; n < item.name.length; n += 1) next[p + n] = item.name.charCodeAt(n);
      dv.setUint32(p + 16, cursor, true);
      dv.setUint32(p + 20, data.length, true);
      next[p + 24] = item.flags ?? 0;
      if (data.length) next.set(data, cursor);
      cursor += data.length;
    }
    this.bytes = next;
  }

  writeFile(filename, content, flags = 0) {
    const name = asciiName(filename);
    const data = content instanceof Uint8Array ? content : new Uint8Array(content);
    if (data.byteLength > 0xffff) throw new Error("File too large (maximum 65535 bytes)");
    const current = this.entries();
    const old = current.find(e => e.name === name);
    if (old?.flags & FLAG_DIRECTORY) throw new Error("A directory already has that name");
    this._requireParentDirectory(name, current);
    const entries = current.filter(e => e.name !== name);
    if (!old && entries.length >= MAX_FILES) throw new Error("Directory full");
    entries.push({ name, data, flags: Number(flags) & 0xff });
    this._replaceEntries(entries);
  }

  /** Add missing executable files from a bundled system disk without replacing user files. */
  installMissingExecutables(sourceDisk) {
    if (!(sourceDisk instanceof DiskImage)) throw new TypeError("sourceDisk must be a DiskImage");
    const installed = [];
    const names = new Set(this.entries().map(entry => entry.name));
    for (const entry of sourceDisk.entries()) {
      if (!(entry.flags & FLAG_EXECUTABLE) || (entry.flags & FLAG_DIRECTORY) || names.has(entry.name)) continue;
      const content = sourceDisk.readFile(entry.name);
      if (!content) continue;
      try {
        this.writeFile(entry.name, content, entry.flags);
        names.add(entry.name);
        installed.push(entry.name);
      } catch (error) {
        // A full user disk must remain intact; later bundled apps can be installed
        // once the user frees a directory entry or disk space.
        break;
      }
    }
    return installed;
  }

  makeDirectory(pathname) {
    const name = asciiName(pathname);
    const entries = this.entries();
    if (entries.some(e => e.name === name)) throw new Error("Name already exists");
    this._requireParentDirectory(name, entries);
    if (entries.length >= MAX_FILES) throw new Error("Directory full");
    entries.push({ name, offset: DATA_OFFSET, size: 0, flags: FLAG_DIRECTORY });
    this._replaceEntries(entries);
  }

  removeFile(filename) {
    const name = asciiName(filename);
    const entries = this.entries();
    const entry = entries.find(e => e.name === name);
    if (!entry || (entry.flags & FLAG_DIRECTORY)) throw new Error("File not found");
    this._replaceEntries(entries.filter(e => e.name !== name));
  }

  removeDirectory(pathname) {
    const name = asciiName(pathname);
    const entries = this.entries();
    const entry = entries.find(e => e.name === name);
    if (!entry || !(entry.flags & FLAG_DIRECTORY)) throw new Error("Directory not found");
    if (entries.some(e => e.name.startsWith(`${name}/`))) throw new Error("Directory is not empty");
    this._replaceEntries(entries.filter(e => e.name !== name));
  }

  /** Implements the disk-controller commands used by the assembled OS ROM. */
  executeCommand(command, memory, registers) {
    const { namePointer, dataPointer, size } = registers;
    if (command === 1) {
      const items = this.list();
      for (let i = 0; i < items.length; i += 1) {
        const p = (dataPointer + i * DIRECTORY_RECORD_BYTES) & 0xffff;
        const name = items[i].name;
        memory.fill(0, p, p + DIRECTORY_RECORD_BYTES);
        for (let n = 0; n < name.length; n += 1) memory[(p + n) & 0xffff] = name.charCodeAt(n);
        memory[(p + 16) & 0xffff] = items[i].size & 0xff;
        memory[(p + 17) & 0xffff] = (items[i].size >>> 8) & 0xff;
        memory[(p + 18) & 0xffff] = items[i].flags & 0xff;
      }
      return { status: 0, count: items.length, size: 0 };
    }
    const name = readCString(memory, namePointer);
    if (!name) return { status: 1, count: 0, size: 0 };
    if (command === 2) {
      const data = this.readFile(name);
      // Executable/data loads may occupy RAM but must not overwrite mapped I/O or ROM.
      if (!data || data.length > 0xffff || dataPointer < 0x0200 || dataPointer + data.length > 0xd000) return { status: 1, count: 0, size: 0 };
      memory.set(data, dataPointer);
      return { status: 0, count: 0, size: data.length };
    }
    if (command === 3) {
      if (dataPointer + size > 0x10000) return { status: 2, count: 0, size: 0 };
      try {
        this.writeFile(name, memory.slice(dataPointer, dataPointer + size));
        return { status: 0, count: 0, size };
      } catch {
        return { status: 2, count: 0, size: 0 };
      }
    }
    if (command === 4) {
      try { this.makeDirectory(name); return { status: 0, count: 0, size: 0 }; }
      catch { return { status: 2, count: 0, size: 0 }; }
    }
    if (command === 5) {
      try { this.removeFile(name); return { status: 0, count: 0, size: 0 }; }
      catch { return { status: 1, count: 0, size: 0 }; }
    }
    if (command === 6) {
      try { this.removeDirectory(name); return { status: 0, count: 0, size: 0 }; }
      catch { return { status: 1, count: 0, size: 0 }; }
    }
    return { status: 0xff, count: 0, size: 0 };
  }

  toArrayBuffer() { return this.bytes.slice().buffer; }
}

export { asciiName };
