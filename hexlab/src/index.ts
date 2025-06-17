import {
  ILayoutRestorer,
  ILabShell,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import { ISettingRegistry } from '@jupyterlab/settingregistry';

import { IFileBrowserFactory } from "@jupyterlab/filebrowser";

import { INotebookShell } from '@jupyter-notebook/application';

import {
  ICommandPalette,
  WidgetTracker,
} from '@jupyterlab/apputils';

import { Signal } from '@lumino/signaling';

import { Panel, Widget } from '@lumino/widgets';

import { Buffer } from 'buffer';

const DEBUG = true;

function debugLog(message: any) {
  if (DEBUG) {
    console.log(message);
  }
}

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
      debugLog('[HexLab][MGR] Correcting out-of-bounds position ' + position);
      new_position = this.clampPositionToValidByteIndices(new_position);
    }
    if (!this.isValidRowStartPosition(new_position)) {
      debugLog('[HexLab][MGR] Correcting non-row-start position ' + position);
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
    debugLog('[HexLab] ******** Drag Cursor ********');
    let pageRange = this.getPageByteRangeInclusive();
    if (!(this._cursor >= pageRange[0] && this._cursor <= pageRange[1])) {
      let cursorRowStart = this.getClosestRowStartForPosition(this.cursor);
      let rowPosition = this._cursor - cursorRowStart;
      debugLog('Page bRange' + pageRange);
      debugLog('maxcellcount ' + this.getMaxCellCountClamped());
      debugLog('last page rowstart ' + this.getClosestRowStartForPosition(pageRange[1]));
      debugLog('---');
      debugLog('cursor row start ' + cursorRowStart);
      debugLog('row offset ' + rowPosition);
      debugLog('---');

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
      debugLog('ctop ' + closestPosTopRow);
      debugLog('cbott ' + closestPosBottomRow);
      debugLog('newpos ' + newPosition);

      this.cursor = newPosition;
      debugLog('[HexLab] ****************');
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

class HexScrollBar {
  scrollBar: HTMLElement;
  scrollGrip: HTMLElement;

  // TODO find a better way for these
  static GRIP_TOTAL_DIMENSIONS = 28
  // ........

  manager: any;

  constructor(manager: any) {
    this.manager = manager;

    const scrollBar = document.createElement('div');
    scrollBar.classList.add('hexlab_scrollbar');
    this.scrollBar = scrollBar;

    // The Grip is shaped like a half circle plus
    // two squares plus another half circle

    // The grip top (circle/half shows on top)
    const scrollGrip = document.createElement('div');
    scrollGrip.classList.add('hexlab_scroll_grip');
    scrollBar.appendChild(scrollGrip);
    this.scrollGrip = scrollGrip;

    // The middle (rectangle) part
    const scrollGripPt2 = document.createElement('div');
    scrollGripPt2.classList.add('hexlab_scroll_grip_pt2');
    this.scrollGrip.appendChild(scrollGripPt2);

    // The grip bottom (circle/half shows on bottom)
    const scrollGripPt3 = document.createElement('div');
    scrollGripPt3.classList.add('hexlab_scroll_grip_pt3');
    scrollGripPt2.appendChild(scrollGripPt3);
  }

  get node(): HTMLElement {
    return this.scrollBar;
  }

  get grip(): HTMLElement {
    return this.scrollGrip;
  }

  getMinGripScroll() {
    // Switched to grip with margin with relative positioning,
    // so the top of the grip/min grip position should be 0 (0 means
    // relative to its position in normal flow, which would already
    // be offset from the scrollbar/parent because of the margin)

    let minScrollInScrollbarRelativeCoords = 0;
    return minScrollInScrollbarRelativeCoords;
  }

  getMaxGripScroll() {
    // Grip position setting uses the top of the grip rect,
    // so we need to leave space for the whole grip circle +
    // the grip margin at the bottom so it doesn't overflow
    // the scrollbar
    let scrollbarRect = this.scrollBar.getBoundingClientRect();

    let scrollHeight = scrollbarRect.height;

    let maxScrollInScrollbarRelativeCoords = (
      scrollHeight - HexScrollBar.GRIP_TOTAL_DIMENSIONS
    );
    return maxScrollInScrollbarRelativeCoords;
  }

  getValidGripPositionRange() {
    return [this.getMinGripScroll(), this.getMaxGripScroll()];
  }

  getAllValidPixelPositions(){
    let range = this.getValidGripPositionRange();
    let total_pixel_positions = range[1] - range[0];
    return total_pixel_positions;
  }

  // TODO make this private/refactor
  setGripPosition(gripPosition: number) {
    let newPosition = gripPosition;
    if (!this.gripPositionValid(newPosition)) {
      debugLog('[HexLab] ERROR correcting bad grip position');
      newPosition = Math.max(this.getMinGripScroll(), Math.min(this.getMaxGripScroll(), newPosition))
    }
    this.scrollGrip.style.top = newPosition.toString() + 'px';
  }

  // Set scroll grip visual position to match a given data position/progress
  setPosition(user_data_position: number) {
    // Count how many data rows there will be, and our progress through the
    // total row count (scrollbar will always represent a row start position)
    let total_row_count = this.manager.getTotalRowsNeeded();
    let current_row_count = Math.floor(user_data_position / this.manager.getMaxCellCountClamped());

    let closest_grip_pixel_position = (
      this.getMinGripScroll() + Math.round(1.0 * current_row_count / total_row_count * this.getAllValidPixelPositions())
    );
    this.setGripPosition(closest_grip_pixel_position);
  }

  gripPositionValid(gripPosition: number) {
    let range = this.getValidGripPositionRange();
    if (gripPosition >= range[0] && gripPosition <= range[1]) {
      return true;
    }
    return false;
  }

  clampGripPosition(gripPosition: number) {
    let newPosition = gripPosition;
    if (!this.gripPositionValid(newPosition)) {
      newPosition = Math.max(this.getMinGripScroll(), Math.min(this.getMaxGripScroll(), gripPosition));
    }
    return newPosition;
  }

  // Set the grip position based on a grip drag event, return
  // the data position corresponding to that scroll grip pixel position
  setDragPosition(gripPosition: number): number {
    let newPosition = this.clampGripPosition(gripPosition);

    this.setGripPosition(newPosition);
    if (newPosition == this.getMaxGripScroll()) {
      return this.manager.getLastDataStartPosition();
    }

    let total_row_count = this.manager.getTotalRowsNeeded();
    let gripPositionAsPercent = newPosition * 1.0 / this.getMaxGripScroll();

    return Math.round(total_row_count * gripPositionAsPercent) * this.manager.getMaxCellCountClamped();
  }
}

class HexEditorWidget extends Widget {
  // Main extension widget

  manager: HexManager;

  app: any;  // TODO fix

  mainArea: HTMLElement;
  workspace: HTMLElement;
  topArea: HTMLElement;
  bottomArea: HTMLElement;
  fileControls: HTMLElement;
  openButton: any;
  openInputHidden: any;
  clearFileButton: any;
  fileLabel: HTMLElement;
  topDivider: HTMLElement;
  topAreaLowerRowControls: HTMLElement;
  gridWidthLabel: HTMLElement;
  gridWidthCountLbl: HTMLElement;
  currentByteLabel: HTMLElement;
  decreaseGridWidthBtn: HTMLElement;
  dragGridWidthBtn: HTMLElement;
  increaseGridWidthBtn: HTMLElement;
  addressGrid: HTMLElement;
  hexGrid: HTMLElement;
  previewGrid: HTMLElement;
  scrollControls: HTMLElement;
  scrollbar: HexScrollBar;
  scrollGrip: any;
  scrollPageUp: any;
  scrollPageDown: any;
  mouseListenerAttached = false;
  gridWidthListenerAttached = false;
  gridWidthListener: any;
  gridWidthDragStartWidth = 0;
  gridWidthDragStartPos = 0;
  scrollDragListener: any;
  lastGridFillTimestamp: any = new Date();
  // ////////
  // HexLab has logic for automatic reflow/resizability depending on the
  // window width. More work needs to be done for full and correct automatic
  // resizing and reflow-ability. Until then, sizing will be fixed (at a user
  // specified byte width) and responsiblity for resizing will be ceded to
  // the user (with controls for manually increasing/decreasing byte width).
  desiredGridWidth = 10;
  // ////////

  gridResizeChecker: any;

  CELLROWMARGIN = 8;
  CELL_WIDTH = 24;  
  CELL_MARGIN = 2;

  constructor(app: any) {
    super();

    this.manager = new HexManager();
    this.manager.fileOpenSuccess.connect(this.handleFileLoadSuccess.bind(this));
    this.manager.fileOpenFailure.connect(this.resetEditorState.bind(this));

    this.app = app;

    // Add styling and build layout tree
    this.node.classList.add('hexlab_root_widget');

    // Build layout subtree
    // ....................
    // Add a root element into the jupyter-widget (full hex UI fits in here)
    this.mainArea = document.createElement('div');
    this.mainArea.classList.add('hexlab_main_area');
    this.node.appendChild(this.mainArea);

    // Top area has controls for opening a local file and 
    let topArea = document.createElement('div');
    topArea.classList.add('--jp-code-font-family');
    topArea.classList.add('--jp-code-font-size');
    topArea.classList.add('hexlab_top_area');
    this.mainArea.appendChild(topArea);
    this.topArea = topArea;

    // File management area
    this.fileControls = document.createElement('div');
    this.fileControls.classList.add('hexlab_file_controls');
    this.topArea.appendChild(this.fileControls);

    // Set up the file open button and filename label
    this.openButton = document.createElement('div');
    this.openInputHidden = document.createElement('input');
    this.openInputHidden.setAttribute('type', 'file');
    this.openButton.appendChild(this.openInputHidden);
    this.openButton.classList.add('hexlab_input_style');
    this.openButton.classList.add('hexlab_open_button');
    this.openButton.innerText = 'Load File';
    this.openButton.addEventListener('click', this.triggerFileDialog.bind(this), {passive: true});
    this.openInputHidden.addEventListener('input' , this.startFileLoad.bind(this), {passive: true});
    this.fileControls.appendChild(this.openButton);

    // Add a button for clearing/unloading the current file
    this.clearFileButton = document.createElement('div');
    this.clearFileButton.classList.add('hexlab_close_file_button');
    this.clearFileButton.innerText = '\u{00d7}';
    this.clearFileButton.addEventListener('click', this.handleCloseFile.bind(this), {passive: true});
    this.fileControls.appendChild(this.clearFileButton);

    // Label shows the name of the current open file
    let fileLabel = document.createElement('div');
    fileLabel.classList.add('hexlab_file_label');
    this.fileControls.appendChild(fileLabel);
    fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
    this.fileLabel = fileLabel;

    // Divider for a new row of top area controls
    this.topDivider = document.createElement('div');
    this.topDivider.classList.add('hexlab_top_divider');
    this.topArea.appendChild(this.topDivider)

    // Controls for expanding/shrinking the displayed byte width
    this.topAreaLowerRowControls = document.createElement('div');
    this.topAreaLowerRowControls.classList.add('hexlab_grid_width_controls');
    this.topArea.appendChild(this.topAreaLowerRowControls);
    // ....
    this.gridWidthLabel = document.createElement('div');
    this.gridWidthLabel.classList.add('hexlab_grid_width_lbl');
    this.gridWidthLabel.innerText = 'Bytes per row';
    this.topAreaLowerRowControls.appendChild(this.gridWidthLabel)
    // ....
    this.decreaseGridWidthBtn = document.createElement('div');
    this.decreaseGridWidthBtn.classList.add('hexlab_decrease_grid_width_btn');
    this.decreaseGridWidthBtn.innerText = '\u{25c0}';
    this.decreaseGridWidthBtn.addEventListener('click', this.handleGridWidthDecrease.bind(this), {passive: true});
    this.topAreaLowerRowControls.appendChild(this.decreaseGridWidthBtn)
    // ....
    this.dragGridWidthBtn = document.createElement('div');
    this.dragGridWidthBtn.classList.add('hexlab_drag_grid_width_btn');
    this.dragGridWidthBtn.innerText= '\u{2b0c}';
    this.dragGridWidthBtn.addEventListener('mousedown', this.handleGridWidthDragStart.bind(this), {passive: true});
    this.gridWidthListener = this.handleGridWidthDragMove.bind(this)
    this.topAreaLowerRowControls.appendChild(this.dragGridWidthBtn)
    // ....
    this.increaseGridWidthBtn = document.createElement('div');
    this.increaseGridWidthBtn.classList.add('hexlab_increase_grid_width_btn');
    this.increaseGridWidthBtn.innerText = '\u{25b6}';
    this.increaseGridWidthBtn.addEventListener('click', this.handleGridWidthIncrease.bind(this), {passive: true});
    this.topAreaLowerRowControls.appendChild(this.increaseGridWidthBtn)
    // ....
    this.gridWidthCountLbl = document.createElement('div');
    this.gridWidthCountLbl.classList.add('hexlab_grid_count_lbl');
    this.gridWidthCountLbl.innerText = '()';
    this.topAreaLowerRowControls.appendChild(this.gridWidthCountLbl)
    // ....
    let divider = document.createElement('div');
    divider.classList.add('hexlab_vertical_divider');
    this.topAreaLowerRowControls.appendChild(divider);

    // Define a container to hold the hex grid and related controls
    this.workspace = document.createElement('div');
    this.workspace.classList.add('hexlab_workspace');
    this.gridResizeChecker = new ResizeObserver(this.handleGridResize.bind(this));
    this.gridResizeChecker.observe(this.node);
    this.mainArea.appendChild(this.workspace);

    // Add a column on the grid for data addresses
    this.addressGrid = document.createElement('div');
    this.addressGrid.classList.add('hexlab_address_grid');
    this.workspace.appendChild(this.addressGrid);

    // Define a grid with slots to hold byte content
    this.hexGrid = document.createElement('div');
    this.hexGrid.classList.add('hexlab_hex_grid');
    this.hexGrid.classList.add('--jp-code-font-family');
    this.hexGrid.classList.add('--jp-code-font-size');

    // Add a grid for the data preview
    this.previewGrid = document.createElement('div');
    this.previewGrid.classList.add('hexlab_preview_grid');

    this.scrollControls = document.createElement('div');
    this.scrollControls.classList.add('hexlab_scroll_controls');

    // Data scrolling is handled manually via this scrollbar.
    // This is not "true" scrolling (of a long element with overflow),
    // the scrollbar only tracks a position in the user's data, where
    // the (currently viewed) page starts (indicated by the position
    // of the scroll grip). The data position drives cell population
    // on the page. The hexgrid itself will never be populated such
    // that it overflows its parent container, it shows only the page/
    // slice of data that's currently being viewed.
    this.scrollbar = new HexScrollBar(this.manager);
    this.scrollGrip = this.scrollbar.grip;  // TODO refactor access
    this.scrollDragListener = this.handleScrollGripDragMove.bind(this)
    this.scrollGrip.addEventListener('mousedown', this.handleScrollGripDragStart.bind(this));
    this.scrollControls.appendChild(this.scrollbar.node);

    this.scrollPageUp = document.createElement('div');
    this.scrollPageUp.classList.add('hexlab_scroll_pageup');
    this.scrollPageUp.addEventListener('click', this.handleScrollPageUp.bind(this));
    this.scrollPageUp.innerText = '\u{25b2}';
    this.scrollControls.appendChild(this.scrollPageUp);

    this.scrollPageDown = document.createElement('div');
    this.scrollPageDown.classList.add('hexlab_scroll_pagedown');
    this.scrollPageDown.addEventListener('click', this.handleScrollPageDown.bind(this));
    this.scrollPageDown.innerText = '\u{25bc}';
    this.scrollControls.appendChild(this.scrollPageDown);

    this.workspace.appendChild(this.hexGrid);
    this.workspace.appendChild(this.previewGrid);
    this.workspace.appendChild(this.scrollControls);

    // Divider for a new row of top area controls
    let dividerBottom = document.createElement('div');
    dividerBottom.classList.add('hexlab_bottom_divider');
    this.mainArea.appendChild(dividerBottom);

    // Create a lower area for 
    let bottomArea = document.createElement('div');
    bottomArea.classList.add('hexlab_top_area');
    this.mainArea.appendChild(bottomArea);
    this.bottomArea = bottomArea;

    // Cursor display
    this.currentByteLabel = document.createElement('div');
    this.currentByteLabel.classList.add('hexlab_current_byte_lbl');
    this.currentByteLabel.innerText = 'Byte 0-Index: 0x0 (0)';
    this.bottomArea.appendChild(this.currentByteLabel);

    this.setGridWidth(this.desiredGridWidth);
    this.setWorkspaceVisible(false);
    this.configureAndFillGrid();
    this.node.addEventListener('wheel', this.handleWheelEvent.bind(this));
  }

  setWorkspaceVisible(state: boolean) {
    if (state) {
      this.workspace.style.visibility = 'visible';
    }
    else {
      this.workspace.style.visibility = 'hidden';
    }
  }

  // Set number of bytes per page row
  setGridWidth(width: number) {
    this.desiredGridWidth = Math.max(1, width);
    this.gridWidthCountLbl.innerText = '(' + this.desiredGridWidth + ')' ;
    this.setManagerPageMetrics();
    // Note that the current position may be invalid after reflow (not a row start),
    // corerect it so the position is a multiple of the max cell count
    this.manager.setPositionOnReflow();
    this.configureAndFillGrid();
  }

  handleGridWidthDecrease() {
    debugLog('[HexLab] Decrease grid width');
    this.setGridWidth(this.desiredGridWidth - 1);
  }

  handleGridWidthIncrease() {
    debugLog('[HexLab] Increase grid width');
    this.setGridWidth(this.desiredGridWidth + 1);
  }

  handleScrollPageUp() {
    console.log('[HexLab] Request page up');
    let pageRowsMinusOne = Math.max(0, this.manager.getMaxRowCountClamped() - 1);
    this.manager.position = (
      this.manager.getClosestRowStartForPosition(
        this.manager.clampPositionToValidByteIndices(
          this.manager.position
          - (pageRowsMinusOne * this.manager.getMaxCellCountClamped())
        )
      )
    )
    this.scrollbar.setPosition(this.manager.position);
    // this.manager.dragCursor();
    this.configureAndFillGrid();
  }

  handleScrollPageDown() {
    console.log('[HexLab] Request page down');
    let pageRowsMinusOne = Math.max(0, this.manager.getMaxRowCountClamped() - 1);
    this.manager.position = (
      this.manager.getClosestRowStartForPosition(
        this.manager.clampPositionToValidByteIndices(
          this.manager.position
          + (pageRowsMinusOne * this.manager.getMaxCellCountClamped())
        )
      )
    )
    this.scrollbar.setPosition(this.manager.position);
    // this.manager.dragCursor();
    this.configureAndFillGrid();
  }

  handleCloseFile() {
    this.clearLoadedFile();
  }

  triggerFileDialog() {
    // Trigger the <input> element to get a file dialog
    this.openInputHidden.click();
  }

  // Completely empty the hex grid of all elements/content
  clearGrid() {
    this.hexGrid.innerText = '';
    this.addressGrid.innerText = '';
    this.previewGrid.innerText = '';
  }

  // Remove the loaded file, clear all display state
  clearLoadedFile() {
    this.manager.clear();
    this.resetEditorState();
  }

  // Remove all display state for the current file, reset view
  resetEditorState() {
    this.clearGrid();
    this.setWorkspaceVisible(false);

    this.scrollbar.setGripPosition(this.scrollbar.getMinGripScroll());
    this.fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
    this.currentByteLabel.innerText = 'Byte 0-Index: 0x0 (0)'
  }

  async handleLabFileBrowserOpen(userFile: any, fileBrowser: any) {
    const fileData = await this.app.serviceManager.contents.get(
      userFile.value.path,
      { content: true, format: 'base64', type: 'base64' }
    );
    // debugLog(`xFILE CONTs:\n${JSON.stringify(fileData)}`);

// {
//   "name": "notes1.rtf",
//   "path": "notes1.rtf",
//   "last_modified": "2022-05-02T15:34:46.162414Z",
//   "created": "2024-07-29T17:41:10.512824Z",
//   "content": FOO,
//   "format": "base64",
//   "mimetype": "application/rtf",
//   "size": 466,
//   "writable": true,
//   "hash": null,
//   "hash_algorithm": null,
//   "type": "file",
//   "serverPath": "notes1.rtf"
// }

    // const bodyWidget = new FssFileUploadContextPopup();
    // this.uploadDialog = new Dialog({
    //   body: bodyWidget,
    //   title: 'Upload file'
    // });

    // const result = await this.uploadDialog.launch();

    // if (result?.value) {
    //   this.logger.debug('Filename provided', { filename: result.value });
    //   return result;
    // }

    if (!('size' in fileData) && !('contents' in fileData)) {
      console.log('[HexLab] Error, no file size or contents!');
      return;
    }

    await this.startFileLoad(fileData);
  }

  async startFileLoad(data: any) {
    console.log('[HexLab] ******** Handling File Selection Change ********');

    let fromLabBrowser = false;

    let fileData: any = null;
    if (data != null) {
      fileData = data;
      fromLabBrowser = true;
    } else {
      // Obtain the file path
      debugLog('[Hexlab] File list');
      debugLog(this.openInputHidden.files);
      if (this.openInputHidden.files.length > 0) {
        fileData = this.openInputHidden.files[0];
      } else {
        console.log('[Hexlab] No file selected');
        return;
      }
    }

    // Clear displayed hex data, attempt file load
    this.clearLoadedFile();
    this.manager.openFile(fileData, fromLabBrowser);
  }

  handleFileLoadSuccess() {
    // Success, repopulate the view
    debugLog('[HexLab] ******** Handle file load success ********');

    // Clear the list of files since we've already handled it
    this.openInputHidden.value = null;

    // Set the filename display
    this.fileLabel.innerText = (
      'File: ' + this.manager.getCurrentFilename()
      + '\n' + this.manager.fileSize + ' (0x'
      + this.manager.fileSize.toString(16) + ') bytes'
    );
    this.setWorkspaceVisible(true);

    // Rebuild and populate grid
    this.configureAndFillGrid();
  }

  cellsPerWidth() {
    // Gets raw how-many-cells-fit-in-this-page-width value
    // (doesn't impose any minimums etc, just gives cells per width)

    // Determines how many cells can fit in the hex area width
    let gridWidthRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('width');
    let gridWidth: number = parseInt(gridWidthRaw) - (2 * this.CELLROWMARGIN);

    return Math.floor(
      ((gridWidth - this.CELL_MARGIN) / (this.CELL_MARGIN + this.CELL_WIDTH))
    )
  }

  rowsPerHeight() {
    // Gets raw how-many-row-fit-in-this-page-height value
    // (doesn't impose any minimums etc, just gives rows per height)

    // Determines how many rows can fit in the hex area height
    let gridHeightRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('height');
    let gridHeight: number = parseInt(gridHeightRaw);
    console.log(`ROWSPERHEIGHT / ${gridHeightRaw} / ${gridHeight}`)
    console.log(`** / ${JSON.stringify(window.getComputedStyle(this.workspace))}`)

    let maxRows = Math.floor(
      ((gridHeight) / (this.CELL_MARGIN + this.CELL_WIDTH))
    )

    return maxRows;
  }

  getGripScrollRange() {
    // In scrollbar relative coords
    return this.scrollbar.getMaxGripScroll() - this.scrollbar.getMinGripScroll();
  }

  setManagerPageMetrics() {
    this.manager.maxCellCount = this.desiredGridWidth;
    this.manager.maxRowCount = this.rowsPerHeight();

    // TODO re-enable space-based auto sizing
    // this.manager.maxCellCount = this.cellsPerWidth();
    // this.manager.maxRowCount = this.rowsPerHeight();
  }

  handleGridResize() {
    debugLog('[Hexlab] ******** GRID RESIZE ********');

    // Do nothing for empty files
    if (this.manager.isEmpty()) {
      return;
    }

    this.setManagerPageMetrics();
    // this.manager.dragCursor();
    this.scrollbar.setPosition(this.manager.position);
    // TODO automatic resizing is disabled, so we don't
    // reflow on grid resize anymore, finish later
    // this.manager.setPositionOnReflow();
    // this.scrollbar.setPosition(this.manager.position);
    this.configureAndFillGrid();
  }

  handleCellClick(event: any) {
    debugLog('[HexLab] ******** Cell Click ********');
    this.printBasicDiagnosticInfo();
    debugLog(event);

    let cell = event.target;
    this.manager.cursor = cell.metadata.byteIndex;
    this.configureAndFillGrid();
  }

  handlePreviewClick(event: any) {
    debugLog('[HexLab] ******** Preview Click ********');
    this.printBasicDiagnosticInfo();
    debugLog(event);

    let target = event.target;
    this.manager.cursor = target.metadata.byteIndex;
    this.configureAndFillGrid();
  }

  handleWheelEvent(event: any) {
    debugLog('[Hexlab] ******** Wheel event ********')
    debugLog(event)

    // Do nothing for empty files
    if (this.manager.isEmpty()) {
      return;
    }

    // Scroll moves the position by max cell count increments
    // (scrolling by full rows only)
    let minDelta = this.manager.getMaxCellCountClamped();
    let lastScrollPosition = this.manager.getLastDataStartPosition();
    this.printBasicDiagnosticInfo();

    // Check for up/down movement and respond accordingly
    if (event.deltaY < 0) {
      this.manager.position = Math.max(0, this.manager.position - minDelta);
    } else {
      this.manager.position = Math.min(lastScrollPosition, this.manager.position + minDelta);
    }
    if (!this.manager.isValidRowStartPosition(this.manager.position)) {
      // Shouldn't be necessary
      this.manager.position = this.manager.getClosestRowStartForPosition(this.manager.position);
      debugLog('[Hexlab] ERROR bad start position on wheel event');
    }
    this.printBasicDiagnosticInfo();

    // Check the cursor
    let range = this.manager.getPageByteRangeInclusive();
    debugLog('[HexLab] CURSOR RANGE CHECK ' + range)
    // If it's not inside the page, put it back inside
    if (!(this.manager.cursor >= range[0] && this.manager.cursor <= range[1])) {
      debugLog('[Hexlab]   cursor outside');
      if (event.deltaY < 0) {
        debugLog('[Hexlab]   subtract from cursor pos');
        debugLog('[HexLab] 1BEFORE ' + this.manager.cursor)
        this.manager.cursor = this.manager.cursor - minDelta;
        debugLog('[HexLab] 1AFTER ' + this.manager.cursor)
      } else {
        debugLog('[Hexlab]   add to cursor pos');
        debugLog('[HexLab] 2BEFORE ' + this.manager.cursor)
        this.manager.cursor = this.manager.cursor + minDelta;
        debugLog('[HexLab] 2AFTER ' + this.manager.cursor)
      }
    }

    // The position has been modified, make sure the scrollbar reflects the
    // current position on the grid
    this.scrollbar.setPosition(this.manager.position);

    this.configureAndFillGrid();
  }

  handleScrollGripDragMove(event: any) {
    debugLog('[Hexlab] ******** Mouse event! ********');

    // Do nothing for empty files
    if (this.manager.isEmpty()) {
      return;
    }

    // Handles subsequent mouse events until a mouseup
    if (event.type == 'mousemove') {
      debugLog('[Hexlab] -- Move event found --')

      let minScroll = this.scrollbar.getMinGripScroll();
      let maxScroll = this.scrollbar.getMaxGripScroll();

      let gripRect = this.scrollGrip.getBoundingClientRect();
      debugLog('[Hexlab]   GRIPRECT TOP');
      debugLog(gripRect.top);
      let pageY = event.pageY;
      debugLog('[Hexlab]   pageY');
      debugLog(pageY);
      let gripTop = parseInt(gripRect.top);
      debugLog('[Hexlab]   gripTop');
      debugLog(gripTop);
      let scrollbarRect = this.scrollbar.node.getBoundingClientRect();
      let scrollHeight = scrollbarRect.height;
      debugLog('[Hexlab]   scrollbarHeight');
      debugLog(scrollHeight);
      let scrollTop = scrollbarRect.top;
      debugLog('[Hexlab]   scrollTop');
      debugLog(scrollTop);
      let scrollbarRelative = pageY - scrollTop;
      let clampedPosition = Math.min(Math.max(minScroll, scrollbarRelative), maxScroll);

      // TODO refactor this whole func
      let newGripPosition = clampedPosition;
      debugLog('[Hexlab]   NEWGRIP');
      debugLog(newGripPosition);

      // Set the data position
      let closestDataPosition = this.scrollbar.setDragPosition(newGripPosition);
      this.manager.position = closestDataPosition;
      this.manager.dragCursor()

      // Throttle the grid fill op to once per X milliseconds
      let now: any = new Date();
      if ((now - this.lastGridFillTimestamp) > 50) {
        this.configureAndFillGrid();
      }
    }
    if (event.type == 'mouseup') {
      debugLog('[Hexlab] -- mouseUp found! --')

      // Always fill grid on mouseup to ensure correct ending state
      this.configureAndFillGrid();
      window.removeEventListener('mouseup', this.scrollDragListener, false);
      window.removeEventListener('mousemove', this.scrollDragListener, false);
      this.mouseListenerAttached = false;
    }
  }

  printBasicDiagnosticInfo() {
    debugLog('');
    debugLog('[Hexlab]   -------- Diagnostic Info --------');
    debugLog('[Hexlab]     FileName: ' + this.manager.currentFilename);
    debugLog('[Hexlab]     FileSize: ' + this.manager.currentFileSize);
    debugLog('[Hexlab]     Data Position: ' + this.manager.currentPosition);
    debugLog('[Hexlab]     Cursor: ' + this.manager.cursor);
    debugLog('[Hexlab]     lastRowStart: ' + this.manager.getLastDataStartPosition());
    debugLog('[Hexlab]     closestToCursor: ' + this.manager.getClosestRowStartForPosition(this.manager.cursor));
    debugLog('[Hexlab]     pageByteRange: ' + this.manager.getPageByteRangeInclusive());
    debugLog('[Hexlab]     positionValid: ' + this.manager.isValidRowStartPosition(this.manager.currentPosition));
    debugLog('[Hexlab]     positionMultiple: ' + (this.manager.currentPosition % this.manager.getMaxCellCountClamped() == 0));
    debugLog('[Hexlab]   --------');
    debugLog('[Hexlab]     maxCellCount: ' + this.manager.getMaxCellCountClamped());
    debugLog('[Hexlab]     maxRowCount: ' + this.manager.getMaxRowCountClamped());
    debugLog('[Hexlab]   --------');
    debugLog('[Hexlab]     scrollGripPosition: ' + this.scrollbar.grip.style.top);
    debugLog('[Hexlab]     scrollbarHeight: ' + this.scrollbar.node.style.height);
    debugLog('[Hexlab]     gripMin: ' + this.scrollbar.getMinGripScroll());
    debugLog('[Hexlab]     gripMax: ' + this.scrollbar.getMaxGripScroll());
    debugLog('[Hexlab]     gripRange: ' + this.getGripScrollRange());
    debugLog('[Hexlab]   ------ End Diagnostic Info ------');
    debugLog('');
  }

  handleScrollGripDragStart(event: any) {
    debugLog('[Hexlab] ******** Scroll grip drag start! ********');
    if (this.manager.isEmpty()) {
      return;
    }

    this.printBasicDiagnosticInfo();
    if(!this.mouseListenerAttached) {
      window.addEventListener('mouseup', this.scrollDragListener, false);
      window.addEventListener('mousemove', this.scrollDragListener, false);
      this.mouseListenerAttached = true;
      debugLog('[Hexlab] Attached!');
    }
  }

  handleGridWidthDragMove(event: any) {
    debugLog('[Hexlab] ******** Grid width drag mouse event! ********');

    // // Do nothing for empty files
    // if (this.manager.isEmpty()) {
    //   return;
    // }

    // Handles subsequent mouse events until a mouseup
    if (event.type == 'mousemove') {
      debugLog('[Hexlab] -- Move event found --')

      let pageX = event.pageX;
      debugLog('[Hexlab]   pageX');
      debugLog(pageX);

      let CELL_WIDTH = 26;

      let displacement = pageX - this.gridWidthDragStartPos;
      let cellsForWidth = Math.floor(Math.abs(displacement) / CELL_WIDTH);

      let newWidth = this.desiredGridWidth;
      if (displacement < 0) {
        newWidth = this.gridWidthDragStartWidth - cellsForWidth;
      }
      else {
        newWidth = this.gridWidthDragStartWidth + cellsForWidth;
      }

      if (newWidth != this.desiredGridWidth) {
        this.setGridWidth(newWidth);
      }
    }
    if (event.type == 'mouseup') {
      debugLog('[Hexlab] -- mouseUp found! --')

      // Always fill grid on mouseup to ensure correct ending state
      this.configureAndFillGrid();
      window.removeEventListener('mouseup', this.gridWidthListener, false);
      window.removeEventListener('mousemove', this.gridWidthListener, false);
      this.gridWidthListenerAttached = false;
    }
  }

  handleGridWidthDragStart(event: any) {
    debugLog('[Hexlab] ******** Grid width drag start! ********');
    // if (this.manager.isEmpty()) {
    //   return;
    // }

    this.printBasicDiagnosticInfo();
    if(!this.gridWidthListenerAttached) {
      window.addEventListener('mouseup', this.gridWidthListener, false);
      window.addEventListener('mousemove', this.gridWidthListener, false);
      this.gridWidthListenerAttached = true;
      this.gridWidthDragStartWidth = this.desiredGridWidth;
      this.gridWidthDragStartPos = event.pageX;
      debugLog('[Hexlab] Attached!');
    }
  }

  fillGrid() {
    // Fill the cell grid with user byte content
    debugLog('[Hexlab] ******** Fill Grid ********');

    // Do nothing for empty files
    if (this.manager.fileSize < 1) {
      return;
    }

    // Determine how many cells will fit in a row (show a min of 1)
    let maxCellCountClamped = this.manager.getMaxCellCountClamped();

    // Iterate over row/cell containers and populate with data
    let rowItems = this.hexGrid.children;
    let previewItems = this.previewGrid.children;
    for (let rowIndex = 0; rowIndex < rowItems.length; rowIndex++) {
      let hexRow = rowItems[rowIndex];
      let previewRow = previewItems[rowIndex];

      for (let cellIndex = 0; cellIndex < hexRow.children.length; cellIndex++) {  // TODO does a whitespace node show up here?
        let cell: any = hexRow.children[cellIndex];
        let previewCell: any = previewRow.children[cellIndex];

        let byteIndex = this.manager.position + (maxCellCountClamped * rowIndex) + cellIndex;
        // If the byteIndex is valid/inside the data range, populate the hex cell
        if (byteIndex < this.manager.fileSize) {
          let currentByte = this.manager.byte(byteIndex);

          let left_hex = currentByte >> 4;
          let right_hex = 15 & currentByte;

          let charmap: any = {  // TODO any
            0: '0',
            1: '1',
            2: '2',
            3: '3',
            4: '4',
            5: '5',
            6: '6',
            7: '7',
            8: '8',
            9: '9',
            10: 'a',
            11: 'b',
            12: 'c',
            13: 'd',
            14: 'e',
            15: 'f',
          };
          if (cellIndex == 0) {
            cell.style['margin-left'] = '0';
            // cell.style['background-color'] = '#2fc900';
          }
          if (byteIndex == this.manager.cursor) {
            // cell.style['background-color'] = '#c200a8';
            cell.classList.add('hexlab_cursor');
          }

          cell.innerText = charmap[left_hex] + charmap[right_hex];

          // Set preview cell text
          let previewText = '';
          if (currentByte < 128) {
            previewText = String.fromCodePoint(currentByte);
          }
          else {
            previewText = '.'
          }
          if (byteIndex == this.manager.cursor) {
            // cell.style['background-color'] = '#c200a8';
            previewCell.classList.add('hexlab_cursor');
          }
          previewCell.innerText = previewText;
        }
      }
    }
  }

  // The cell grid holds row containers and cells containers that
  // hold the user's hex data, which are constructed here based on
  // the root container's width. Cells don't actually scroll in
  // the typical sense: They are containers that hold appropriate
  // data for the given view position (the grid always holds a
  // single page of data/cells, note that it may be a partial page
  // if the view position is near the end of the file).
  configureGrid() {
    debugLog('[Hexlab] ******** Configure Grid ********');

    // Do nothing for empty files
    if (this.manager.isEmpty()) {
      return;
    }

    // TODO ensure these are deallocated?
    // Remove any existing elements held in the grid
    this.clearGrid();

    // Make the manager aware of the grid space
    this.setManagerPageMetrics()

    this.manager.dragCursor();
    this.currentByteLabel.innerText = (
      'Byte 0-Index: 0x' + this.manager.cursor.toString(16)
      + ' (' + this.manager.cursor + ')'
    );

    // Show some basic stats
    this.printBasicDiagnosticInfo();

    // Determine how many row/cell containers will theoretically fit
    // within the page. Note that the user's data may only fill a portion
    // of the theoretical max container count. Also note that, regardless
    // of how skinny or short the page is, these values are clamped to always
    // give at least 1 row and 1 cell (which will clip in extreme cases).
    let maxCellCountClamped = this.manager.getMaxCellCountClamped();
    let maxRowCountClamped = this.manager.getMaxRowCountClamped();
    console.log(`GRID POP Stats: ${maxCellCountClamped} // ${maxRowCountClamped}`);

    // Get the range of valid data indices that could fit on the page
    // for the given data position (note that we may not have enough
    // data indices to fill the theoretical max cell count/page size
    // if we're near the end of the user's file)
    let range = this.manager.getPageByteRangeInclusive();

    // Make rows until the file end is reached
    let rowElements: any = [];
    let previewElements: any = [];
    let rowStartPos = this.manager.position;
    while (rowStartPos <= range[1]) {
      // Make a row container that holds the bytes for that row
      let hexRow: any = document.createElement('div');
      hexRow.classList.add('hexlab_hex_row');
      hexRow.metadata = {
        byteIndex: rowStartPos
      }

      this.hexGrid.appendChild(hexRow);
      rowElements.push(hexRow);
      // debugLog('[Hexlab] Add row for start byte: ' + rowStartPos);

      // Also make corresponding preview containers per row
      // (holds user-data-as-text cells)
      let previewContainer = document.createElement('div');
      previewContainer.classList.add('hexlab_preview_container');
      this.previewGrid.appendChild(previewContainer);
      previewElements.push(previewContainer);

      // The data position at the start of the row is checked to determine
      // whether a new row is needed. Increment the row's data start position
      // by the max cell count (ie 1 row) to determine if another row is needed.
      rowStartPos += maxCellCountClamped;
    }
    debugLog('[Hexlab] Actual rows created: ' + rowElements.length);
    if (rowElements.length > maxRowCountClamped) {
       debugLog('[Hexlab] ERROR: Actual rows exceeds max ');
    }

    // Add cells to each row until the file end is reached
    for (let rowCount = 0; rowCount < rowElements.length; rowCount++) {
      // debugLog('[Hexlab] -- Row Start @ '+ rowCount);
      for (let cellPosition = 0; cellPosition < maxCellCountClamped; cellPosition++) {
        let currentRow = rowElements[rowCount];
        let currentPreview = previewElements[rowCount];

        // Get the data position of the hex cell we're going to make (the
        // byte this cell is going to display)
        let bytePosition = this.manager.position + (maxCellCountClamped * rowCount) + cellPosition;
      //  debugLog('[Hexlab] BytePosition');
      //  debugLog(bytePosition);

        // Once per row, set the row address contents on the addressGrid
        if (cellPosition == 0) {
          // Make an address row container
          let addressContainer: any = document.createElement('div');
          addressContainer.classList.add('hexlab_address_container');
          this.addressGrid.appendChild(addressContainer);

          // Set address contents
          let addressText = '0x' + bytePosition.toString(16).padStart(4, "0");
          for (let char of addressText) {
            let addressCell: any = document.createElement('div');
            addressCell.classList.add('hexlab_address_cell');  // TODO class constants
            addressCell.innerText = char;
            addressContainer.appendChild(addressCell);
          }
        }

        // Add a cell if the position is valid (not past file size bounds)
        if (bytePosition < this.manager.fileSize) {
          // Create the hex cell layout item
          let hexCell: any = document.createElement('div');
          hexCell.classList.add('hexlab_hex_byte');
          hexCell.metadata = {
            byteIndex: bytePosition
          }
          hexCell.addEventListener('mousedown', this.handleCellClick.bind(this));

          // Do any cell post processing here
          if (cellPosition == maxCellCountClamped - 1 || bytePosition == this.manager.fileSize - 1) {
            // debugLog('[Hexlab] last cell in row at ' + bytePosition);
            // hexCell.style['background-color'] = 'red';
            hexCell.style['margin-right'] = '0px';
          }
          if (bytePosition == this.manager.fileSize - 1) {
            // debugLog('[Hexlab] Last file byte! ' + bytePosition);
            // hexCell.style['background-color'] = 'blue';
          }

          // Append the cell to the layout row
          currentRow.appendChild(hexCell);

          // Add corresponding text preview cell for this byte
          let previewCell: any = document.createElement('div');
          previewCell.classList.add('hexlab_preview_cell');
          previewCell.metadata = {
            byteIndex: bytePosition
          }
          previewCell.addEventListener('mousedown', this.handlePreviewClick.bind(this));

          // Append the preview cell to the preview row
          currentPreview.appendChild(previewCell)
        }
        else {
          // This byte position is past the data end,
          // make an invisible layout placeholder

          // Create the hex cell layout item
          let hexCell: any = document.createElement('div');
          hexCell.classList.add('hexlab_hex_byte');
          hexCell.classList.add('hexlab_hex_placeholder_byte');

          // Append the cell to the layout row
          currentRow.appendChild(hexCell);

          // Add corresponding text preview cell for this byte
          let previewCell: any = document.createElement('div');
          previewCell.classList.add('hexlab_preview_placeholder_cell');
          previewCell.classList.add('hexlab_preview_cell');
          previewCell.metadata = {
            byteIndex: bytePosition
          }

          // Append the preview cell to the preview row
          currentPreview.appendChild(previewCell)

          // TODO this is a dynamic cell count feature, fix later
          // debugLog('[Hexlab] STOP cell build before byteposition ' + bytePosition);
          // break;
        }
      }
    }
  }

  configureAndFillGrid() {
    // TODO refactor this
    this.lastGridFillTimestamp = new Date();
    this.configureGrid();
    this.fillGrid();
  }
}


  // requires: [ICommandPalette],
  // optional: [ISettingRegistry, ILayoutRestorer, ILabShell, INotebookShell as any],


/**
* Activate the hexlab widget extension.
*/
function activate(
    app: JupyterFrontEnd,
    palette: ICommandPalette,
    settingRegistry: ISettingRegistry | null,
    restorer: ILayoutRestorer | null,
    labshell: ILabShell | null,
    nbshell: INotebookShell | null,
    fileBrowserFactory: IFileBrowserFactory,
  ) {
  console.log('[Hexlab] JupyterLab extension hexlab is activated!');

  if (settingRegistry) {
    settingRegistry
      .load(plugin.id)
      .then(settings => {
        console.log('hexlab settings loaded:', settings.composite);
      })
      .catch(reason => {
        console.error('Failed to load settings for hexlab.', reason);
      });
  }

  // Widget/panel creator func
  let makeWidget = () => {
    // Make a container panel and widget
    let panel = new Panel();
    const widget = new HexEditorWidget(app);
    panel.addWidget(widget);
    panel.id = 'hexlab';
    panel.title.label = 'Hex Editor';
    panel.title.closable = true;
    return {panel, widget};
  }

  let widgetData: {
    panel: Panel,
    widget: HexEditorWidget
  };

  // Add an application command
  const command: string = 'hexlab:open';
  app.commands.addCommand(command, {
    label: 'Hex Editor',
    execute: () => {

      widgetData = makeWidget();
      let widget = widgetData.widget;
      if (nbshell) {
        app.shell.add(widgetData.panel, 'right');
      } else {
        app.shell.add(widgetData.panel, 'main');
      }
      app.shell.activateById(widget.id);

      // if (!widget || widget.isDisposed) {
      //   const content = new HexEditorWidget(app);
      //   widget = new Panel();
      //   widget.addWidget(content);
      //   widget.id = 'hexlab';
      //   widget.title.label = 'Hex Editor';
      //   widget.title.closable = true;
      // }
      // if (!tracker.has(widget)) {
      //   // Track the state of the widget for later restoration
      //   tracker.add(widget);
      // }
      // if (!widget.isAttached) {
      //   // Attach the widget to the main work area if it's not there
      //   if (nbshell) {
      //     app.shell.add(widget, 'right');
      //   } else {
      //     app.shell.add(widget, 'main');
      //   }
      // }

      // // Activate the widget
      // app.shell.activateById(widget.id);
    }
  });
  palette.addItem({ command, category: 'hexlab' });

  if (fileBrowserFactory) {
    app.commands.addCommand('hexlab:labFileBrowserOpen', {
    label: 'Open in hex editor',
    caption: "Open the file in the hex editor (Hexlab)",
    execute: async () => {
        const fileModel: any = fileBrowserFactory.tracker.currentWidget
          ?.selectedItems()
          .next();
        const file = fileModel.value;

        if (file) {
          widgetData = makeWidget();
          // Add widget to DOM before using it. The widget depends
          // on being inside the DOM for page size calculations to work
          // properly (otherwise we get invalid/unbounded row counts etc.)
          if (nbshell) {
            app.shell.add(widgetData.panel, 'right');
          } else {
            app.shell.add(widgetData.panel, 'main');
          }
          app.shell.activateById(widgetData.widget.id);

          await widgetData.widget.handleLabFileBrowserOpen(
            fileModel,
            fileBrowserFactory.tracker?.currentWidget
          );
        }
      }
    });

    // Add the command to the palette.
    palette.addItem({ 'command': "hexlab:labFileBrowserOpen", category: 'Tutorial' });
  }

  // Track and restore the widget state
  let tracker = new WidgetTracker<Panel>({
    namespace: 'hexlab'
  });
  if (restorer) {
    restorer.restore(tracker, {
      command,
      name: () => 'hexlab'
    });
  }
}


/**
 * Initialization data for the hexlab extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'hexlab:plugin',
  description: 'A Hex editor for JupyterLab.',
  autoStart: true,
  requires: [ICommandPalette],
  optional: [ISettingRegistry, ILayoutRestorer, ILabShell, INotebookShell as any, IFileBrowserFactory],
  activate: activate
};

export default plugin;
