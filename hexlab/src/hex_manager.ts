import { Signal } from '@lumino/signaling';

import { Buffer } from 'buffer';

import { Logger } from './logger'

class HexManager {

  currentBlobData: Uint8Array | null;
  currentFilename: string | null;
  currentFileSize: number;
  // CurrentPosition marks a row-start, and should always
  // be aligned to a max-cell-count multiple (page reflows
  // cause the valid row start positions to change)...this
  // marks the top-left byte position on the page
  currentPosition: number;
  // Cursor is always present in the current page, it marks
  // a byte for the app to focus on during resizing reflow
  // (where the max cell count changes and causes the hex
  // cells to reflow), which should help users orient
  // themselves at a place in the data during page-changing
  // events (Where am I in the data now since the page changed?
  // Oh, there's the cursor, where I was previously...)
  _cursor: number = 0;
  private _maxCellCount: number = 0;
  private _maxRowCount: number = 0;

  fileOpenSuccess: Signal<any, any>;  // TODO type these
  fileOpenFailure: Signal<any, any>;

  constructor() {
    // Initialize data members
    this.currentFilename = null;
    this.currentBlobData = null;
    this.currentFileSize = 0;
    this.currentPosition = 0;

    this.fileOpenSuccess = new Signal<this, number>(this);
    this.fileOpenFailure = new Signal<this, number>(this);
  }

  get cursor(): number {
    return this._cursor;
  }

  // Valid positions are all indices from start
  // to end of file, clamp given position to that range
  clampPositionToValidByteIndices(position: number) {
    return Math.max(0, Math.min(this.fileSize - 1, position));
  }

  // The cursor is a byte position (index) in the user data
  set cursor(position: number) {
    let new_position = this.clampPositionToValidByteIndices(position);
    this._cursor = new_position;
  }

  get fileSize() {
    return this.currentFileSize;
  }

  get position() {
    return this.currentPosition;
  }

  set position(position: number) {
    let range = this.getFileByteRangeInclusive();
    let new_position = position;
    if (!(new_position >= range[0] && new_position <= range[1])) {
      Logger.debug('[HexLab][MGR] Correcting out-of-bounds position ' + position);
      new_position = this.clampPositionToValidByteIndices(new_position);
    }
    if (!this.isValidRowStartPosition(new_position)) {
      Logger.debug('[HexLab][MGR] Correcting non-row-start position ' + position);
      new_position = this.getClosestRowStartForPosition(this.position);
    }
    this.currentPosition = new_position;
  }

  byte(position: number) {
    return this.currentBlobData![position];  // TODO refactor
  }

  isEmpty() {
    return this.currentFileSize < 1;
  }

  clear() {
    this.currentFilename = null;
    this.currentFileSize = 0;  // TODO Fix rare corner cases for empty file/no file div by 0
    this.currentPosition = 0;
    this._cursor = 0;
    this._maxCellCount = 0;
    this._maxRowCount = 0;
  }

  // Stores raw cells-per-width (can be zero)
  set maxCellCount(count: number) {
    this._maxCellCount = count;
  }

  // Stores raw rows-per-height (can be zero)
  set maxRowCount(count: number) {
    this._maxRowCount = count;
  }

  getMaxCellCountClamped() {
    // Get the max number of cells for this page, and clamp
    // the minimum to 1 so that at least 1 cell (column) is always displayed
    let maxCellCount = this._maxCellCount  // TODO refactor/remove
    let maxCellCountClamped = Math.max(maxCellCount, 1);
    return maxCellCountClamped;
  }

  getMaxRowCountClamped() {
    // Get the max number of rows for this page, and clamp
    // the minimum to 1 so that at least 1 row is always displayed
    let maxRowCount = this._maxRowCount;
    let maxRowCountClamped = Math.max(maxRowCount, 1);
    return maxRowCountClamped;
  }

  getFileByteRangeInclusive() {
    let min = 0;
    let max = Math.max(0, this.fileSize - 1)
    return [min, max]
  }

  getLastByteIndex() {
    return this.getFileByteRangeInclusive()[1];
  }

  getPageByteRangeInclusive() {
    // Gets min/max POSITIONS (indices) of bytes on the page
    // (if there's a partial row, end should be last byte index)
    // Note: This is all byte positions showable on the page,
    // does not include indices past current end of file
    if (this.isEmpty()) {
      return [0, 0];
    }

    let start = this.currentPosition;

    let maxCellCountClamped = this.getMaxCellCountClamped();
    let maxRowCountClamped = this.getMaxRowCountClamped();

    // Max end byte at this position is at most [page size] bytes from position
    let lastByteForPageSize = this.currentPosition + (maxCellCountClamped * maxRowCountClamped) - 1;

    // We may be near the end of the file with partial/absent rows
    let end = lastByteForPageSize;
    if (!(end < this.currentFileSize)) {
      end = Math.max(0, this.currentFileSize - 1);
    }

    return [start, end];
  }

  isValidRowStartPosition(position: number) {
    if (position % this._maxCellCount == 0) {
      return true;
    }
    return false;
  }

  // Get total number of rows needed (including any partial row), clamped
  getTotalRowsNeeded() {
    return Math.ceil(this.currentFileSize / this.getMaxCellCountClamped());
  }

  getLastDataStartPosition() {
    // The last data position users can scroll to (last row start).
    // 
    // Cell population begins at the top left starting at user data
    // index 0, and a row fills up when the max cell **count** is hit
    // (the last **position** in that row is max cell count - 1).
    // This means that the start of a new row will always indicate a
    // **position** that is a multiple of the max cell **count** for
    // the given page width.
    //
    // In other words, many positions in the data are not valid row
    // start positions for a given page width, and only show up in the
    // later cells in the row, because they're not multiples of the
    // max cell count for that page width.
    //
    // When the page width changes, user data must reflow to adjust
    // to the new max cell count for the new page width (much like
    // text is reflowed when a document changes its width).

    // Return for empty files
    if (this.currentFileSize < 1) {
      return 0;
    }

    // Actual width may be less than 1 cell wide, do min of 1
    // (1 hex cell with overflow is min display behavior)
    let maxCellCountClamped = Math.max(1, this._maxCellCount);

    // Get total num rows needed (including any partial row)
    let totalRowCount = Math.ceil(this.currentFileSize / maxCellCountClamped);

    let lastPosition = Math.max(0, (totalRowCount - 1)) * maxCellCountClamped;

    return lastPosition;
  }

  getClosestRowStartForPosition(position: number) {
    let maxCellCountClamped = this.getMaxCellCountClamped();

    // Any index past the file bounds goes to last valid row start position
    if (position > this.getLastDataStartPosition()) {
      return this.getLastDataStartPosition();
    }

    let byteCountForPosition = position + 1;
    let rowsNeededForPosition = Math.ceil(byteCountForPosition / maxCellCountClamped);
    let closestRowStartBytePosition = (rowsNeededForPosition * maxCellCountClamped) - maxCellCountClamped;

    return closestRowStartBytePosition;
  }

  setPositionOnReflow() {
    this.position = this.getClosestRowStartForPosition(this.cursor);
  }

  getCurrentFilename() {
    return this.currentFilename;
  }

  dragCursor() {
    // On drag, move the cursor vertically
    Logger.debug('[HexLab] ******** Drag Cursor ********');
    let pageRange = this.getPageByteRangeInclusive();
    if (!(this._cursor >= pageRange[0] && this._cursor <= pageRange[1])) {
      let cursorRowStart = this.getClosestRowStartForPosition(this.cursor);
      let rowPosition = this._cursor - cursorRowStart;
      Logger.debug('Page bRange' + pageRange);
      Logger.debug('maxcellcount ' + this.getMaxCellCountClamped());
      Logger.debug('last page rowstart ' + this.getClosestRowStartForPosition(pageRange[1]));
      Logger.debug('---');
      Logger.debug('cursor row start ' + cursorRowStart);
      Logger.debug('row offset ' + rowPosition);
      Logger.debug('---');

      let closestPosTopRow = this.clampPositionToValidByteIndices(this.position + rowPosition);
      let closestPosBottomRow = this.clampPositionToValidByteIndices(
        this.getClosestRowStartForPosition(pageRange[1]) + rowPosition
      )
      let topDistance = Math.abs(this._cursor - closestPosTopRow);
      let bottomDistance = Math.abs(this._cursor - closestPosBottomRow);

      let newPosition = closestPosTopRow;
      if (bottomDistance < topDistance) {
        newPosition = closestPosBottomRow;
      }
      Logger.debug('ctop ' + closestPosTopRow);
      Logger.debug('cbott ' + closestPosBottomRow);
      Logger.debug('newpos ' + newPosition);

      this.cursor = newPosition;
      Logger.debug('[HexLab] ****************');
    }
  }

  getRowCountForPage() {
    // Return actual rows needed for this page (this may
    // be a partial page needing less than max rows)
    let range = this.getPageByteRangeInclusive();
    let byteCountForPage = range[1] - range[0] + 1;
    let actualRowsNeeded = Math.ceil(1.0 * byteCountForPage / this.getMaxCellCountClamped());
    return actualRowsNeeded;
  }

  async openFile(fileData: any, fromLabBrowser: boolean) {
    console.log('[HexLab] ******** Opening File ********');

    this.clear();

    // TODO restructure and clean up this if/else
    if (fromLabBrowser) {  // Code for new Lab file browser context menu open

      try {

        // Stuff to get uint8aray from lab metadtaa
        const base64String = fileData.content;
        let binRaw = Buffer.from(base64String, 'base64')

        // let binRaw = await fileData.arrayBuffer();
        let binData = new Uint8Array(binRaw);

        // Populate binary data members for this file
        this.currentFilename = fileData.name;
        if (this.currentFilename == null) {
          // TODO check if this is needed
          this.clear();
          this.fileOpenFailure.emit(null);
          return;
        }
        this.currentBlobData = binData;
        this.currentFileSize = binData.length;
        console.log('[Hexlab] Filename: ' + this.currentFilename);
        console.log('[Hexlab] File Size: ' + this.currentFileSize);

        console.log('[Hexlab] File opened successfully');
        this.fileOpenSuccess.emit(null);
      } catch (err) {
        console.log(err);
        console.log('[Hexlab] Unknown error opening file (read more above)');
        this.clear();
        this.fileOpenFailure.emit(null);
        return;
      }

    } else {  // This is the original browser picker code

      // Attempt to get file contents
      try {
        let binRaw = await fileData.arrayBuffer();
        let binData = new Uint8Array(binRaw);

        // Populate binary data members for this file
        this.currentFilename = fileData.name;
        if (this.currentFilename == null) {
          // TODO check if this is needed
          this.clear();
          this.fileOpenFailure.emit(null);
          return;
        }
        this.currentBlobData = binData;
        this.currentFileSize = fileData.size;
        console.log('[Hexlab] Filename: ' + this.currentFilename);
        console.log('[Hexlab] File Size: ' + this.currentFileSize);

        console.log('[Hexlab] File opened successfully');
        this.fileOpenSuccess.emit(null);
      } catch (err) {
        console.log('[Hexlab] Unkown error opening file');
        this.clear();
        this.fileOpenFailure.emit(null);
        return;
      }

    }
  }
}

export { HexManager };
