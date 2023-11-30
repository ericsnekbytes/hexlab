import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  // MainAreaWidget,
  WidgetTracker
} from '@jupyterlab/apputils';

import { Signal } from '@lumino/signaling';

import { Panel, Widget } from '@lumino/widgets';

//import ResizeObserver from 'resize-observer-polyfill';

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

  static STATUS_OKAY = 0;
  static STATUS_FAIL = 1;

  fileOpenSuccess: Signal<any, any>;  // TODO type these
  fileOpenFailure: Signal<any, any>;

  DEBUG = true; // TODO remove

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

  // The cursor is a position (index) in the user data
  set cursor(position: number) {
    this._cursor = Math.max(0, Math.min(this.fileSize, position));
    
  }

  get fileSize() {
    return this.currentFileSize;
  }

  get position() {
    return this.currentPosition;
  }

  set position(position: number) {
    this.currentPosition = Math.max(0, Math.min(this.fileSize, position));
  }

  byte(position: number) {
    return this.currentBlobData![position];  // TODO refactor
  }

  isEmpty() {
    return this.currentFileSize < 1;
  }

  clear() {
    this.currentFilename = null;
    this.currentFileSize = 0;
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

  getCurrentFilename() {
    return this.currentFilename;
  }

  async openFile(fileData: any) {
    console.log('[HexLab] ******** Opening File ********');

    this.clear();

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

  // TODO remove
  debugLog(message: any) {
    if (this.DEBUG) {
      console.log(message)
    }
  }
}

class HexScrollBar {
  scrollBar: HTMLElement;
  scrollGrip: HTMLElement;
  // byteRange: any;
  // maxCellCountClamped: Number;
  manager: any;

  constructor(manager: any) {
    this.manager = manager;

    // this.byteRange = [0, 0];

    const scrollBar = document.createElement('div');
    scrollBar.classList.add('hexlab_scrollbar');
    this.scrollBar = scrollBar;

    const scrollGrip = document.createElement('div');
    scrollGrip.classList.add('hexlab_scroll_grip');
    scrollBar.appendChild(scrollGrip);
    this.scrollGrip = scrollGrip;
  }

  get node(): HTMLElement {
    return this.scrollBar;
  }

  get grip(): HTMLElement {
    return this.scrollGrip;
  }

  // setByteRangeInclusive(min: Number, max: Number) {
  //   this.byteRange = [min, max];
  // }

  getMinGripScroll() {
    // Grip position setting uses the top of the grip rect,
    // so we only need to leave space for the grip margin
    let GRIP_MARGIN = 2;  // TODO refactor/deducplicate

    let minScrollInScrollbarRelativeCoords = GRIP_MARGIN;
    return minScrollInScrollbarRelativeCoords;
  }

  getMaxGripScroll() {
    // Grip position setting uses the top of the grip rect,
    // so we need to leave space for the whole grip circle +
    // the grip margin at the bottom so it doesn't overflow
    // the scrollbar
    let scrollbarRect = this.scrollBar.getBoundingClientRect();

    let scrollHeight = scrollbarRect.height;

    let GRIP_EDGE_SIZE = 8;
    let GRIP_MARGIN = 2;

    let maxScrollInScrollbarRelativeCoords = scrollHeight - GRIP_EDGE_SIZE - GRIP_MARGIN;
    return maxScrollInScrollbarRelativeCoords;
  }

  getValidGripPositionRange() {
    return [this.getMinGripScroll(), this.getMaxGripScroll()];
  }

  getAllValidPixelPositions(){
    let range = this.getValidGripPositionRange();
    let total_pixel_positions = range[0] - range[1];
    return total_pixel_positions;
  }

  // Set scroll grip visual position to match a given data position/progress
  setPosition(user_data_position: number) {
    // Count how many data rows there will be, and our progress through the
    // total row count (scrollbar will always represent a row start position)
    let total_row_count = this.manager.getTotalRowsNeeded();
    let current_row_count = Math.floor(user_data_position / total_row_count);

    let closest_grip_pixel_position = (
      Math.round(1.0 * current_row_count / total_row_count * this.getMaxGripScroll())
    );
    this.scrollGrip.style.top = closest_grip_pixel_position.toString() + 'px';
  }

  // Set the grip position based on a grip drag event, return
  // the data position corresponding to that scroll grip pixel position
  setDragPosition(position: number): number {
    this.scrollGrip.style.top = position.toString() + 'px';

    let total_row_count = this.manager.getTotalRowsNeeded();
    let gripPositionAsPercent = position * 1.0 / this.getMaxGripScroll();

    return Math.round(total_row_count * gripPositionAsPercent) * this.manager.getMaxCellCountClamped();
  }
}

class HexEditorWidget extends Widget {
  // Main extension widget

  manager: HexManager;

  mainArea: HTMLElement;
  workspace: HTMLElement;
  topArea: HTMLElement;
  openButton: any;
  openInputHidden: any;
  fileLabel: HTMLElement;
  hexGrid: HTMLElement;
  scrollbar: HexScrollBar;
  scrollGrip: any;
  mouseListenerAttached = false;
  boundListener: any;
  lastGridFillTimestamp: any = new Date();
  DEBUG = true;

  gridResizeChecker: any;

  constructor() {
    super();

    this.manager = new HexManager();
    this.manager.fileOpenSuccess.connect(this.handleFileLoadSuccess.bind(this));
    this.manager.fileOpenFailure.connect(this.resetEditorState.bind(this));

    // Add styling and build layout tree
    this.node.classList.add('hexlab_root_widget');

    // Build layout subtree
    // ....................
    // Add a root element into the jupyter-widget (full hex UI fits in here)
    this.mainArea = document.createElement('div');
    this.mainArea.classList.add('hexlab_main_area');
    this.node.appendChild(this.mainArea);

    // Top area has controls for opening a local file
    let topArea = document.createElement('div');
    topArea.classList.add('--jp-code-font-family');
    topArea.classList.add('--jp-code-font-size');
    topArea.classList.add('hexlab_top_area');
    this.mainArea.appendChild(topArea);
    this.topArea = topArea;

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
    this.topArea.appendChild(this.openButton);
    // Label shows the name of the current open file
    let fileLabel = document.createElement('div');
    fileLabel.classList.add('hexlab_file_label');
    topArea.appendChild(fileLabel);
    fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
    this.fileLabel = fileLabel;

    // Define a container to hold the hex grid and related controls
    this.workspace = document.createElement('div');
    this.workspace.classList.add('hexlab_workspace');
    this.gridResizeChecker = new ResizeObserver(this.handleGridResize.bind(this));
    this.gridResizeChecker.observe(this.workspace);
    this.mainArea.appendChild(this.workspace);

    // Define a grid with slots to hold byte content
    this.hexGrid = document.createElement('div');
    this.hexGrid.classList.add('hexlab_hex_grid');
    this.hexGrid.classList.add('--jp-code-font-family');
    this.hexGrid.classList.add('--jp-code-font-size');

    // TODO Finish this
    // Data scrolling is handled manually via this scrollbar
    // (this is not true scrolling of a long element with overflow,
    // it only tracks the position in the hex data and uses the
    // scrollGrip to control how the hex grid is populated...the
    // hexgrid itself will never be populated such that it overflows
    // its parent container, it shows only a page that fits within
    // its parent, which should track the size of the window)
    this.scrollbar = new HexScrollBar(this.manager);
    this.scrollGrip = this.scrollbar.grip;  // TODO refactor access
    this.boundListener = this.handleScrollGripDragMove.bind(this)
    this.scrollGrip.addEventListener('mousedown', this.handleScrollGripDragStart.bind(this));
    this.workspace.appendChild(this.hexGrid);
    this.workspace.appendChild(this.scrollbar.node);

    this.configureAndFillGrid();
    this.node.addEventListener('wheel', this.handleWheelEvent.bind(this));
  }

  debugLog(message: any) {
    if (this.DEBUG) {
      console.log(message)
    }
  }

  triggerFileDialog() {
    // Trigger the <input> element to get a file dialog
    this.openInputHidden.click();
  }

  // Completely empty the hex grid of all elements/content
  clearGrid() {
    this.hexGrid.innerText = '';
  }

  // Remove the loaded file, clear all display state
  clearLoadedFile() {
    this.manager.clear();
    this.resetEditorState();
  }

  // Remove all display state for the current file, reset view
  resetEditorState() {
    this.clearGrid();

    this.scrollbar.node.style.top = this.scrollbar.getMinGripScroll().toString() + 'px';
    this.fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
  }

  // resetGridView() {
  //   // Clear/empty current hex grid
  //   this.hexGrid.innerText = '';

  //   this.scrollbar.node.style.top = this.scrollbar.getMinGripScroll().toString() + 'px';
  //   this.fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
  //   this.scrollbar.setByteRangeInclusive(0, 0);
  // }

  async startFileLoad() {
    console.log('[HexLab] ******** Opening File ********');

    // Obtain the file path
    this.debugLog('[Hexlab] File list');
    this.debugLog(this.openInputHidden.files);
    let fileData: any = null;
    if (this.openInputHidden.files.length > 0) {
      fileData = this.openInputHidden.files[0];
    } else {
      console.log('[Hexlab] Error, no file selected');
      return;
    }

    // Clear displayed hex data, attempt file load
    this.clearLoadedFile();
    this.manager.openFile(fileData);
  }

  handleFileLoadSuccess() {
    // Success, repopulate the view
    this.debugLog('******** Handle file load success ********');

    // Set the filename display
    this.fileLabel.innerText = 'File: ' + this.manager.getCurrentFilename();

    // Rebuild and populate grid
    this.configureAndFillGrid();
  }

  cellsPerWidth() {
    // Gets raw how-many-cells-fit-in-this-page-width value
    // (doesn't impose any minimums etc, just gives cells per width)
    let CELLROWMARGIN = 8;  // TODO refactor these values

    // Determines how many cells can fit in the hex area width
    let gridWidthRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('width');
    let gridWidth: number = parseInt(gridWidthRaw) - (2 * CELLROWMARGIN);

    let CELL_WIDTH =  20;  // TODO refactor these values
    let CELL_MARGIN = 8;
    return Math.floor(
      ((gridWidth - CELL_MARGIN) / (CELL_MARGIN + CELL_WIDTH))
    )
  }

  rowsPerHeight() {
    // Gets raw how-many-row-fit-in-this-page-height value
    // (doesn't impose any minimums etc, just gives rows per height)
    let CELLROWMARGIN = 8;

    // Determines how many rows can fit in the hex area height
    let gridHeightRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('height');
    let gridHeight: number = parseInt(gridHeightRaw) - (2 * CELLROWMARGIN);

    let CELL_WIDTH =  20;
    let CELL_MARGIN = 8;
    let maxRows = Math.floor(
      ((gridHeight - CELL_MARGIN) / (CELL_MARGIN + CELL_WIDTH))
    )

    return maxRows;
  }

  getGripScrollRange() {
    // In scrollbar relative coords
    return this.scrollbar.getMaxGripScroll() - this.scrollbar.getMinGripScroll();
  }

  setManagerPageMetrics() {
    this.manager.maxCellCount = this.cellsPerWidth();
    this.manager.maxRowCount = this.rowsPerHeight();
  }

  handleGridResize() {
    this.debugLog('[Hexlab] ******** GRID RESIZE ********');
    this.setManagerPageMetrics()
    this.configureAndFillGrid();
  }

  handleCellClick(event: any) {
    this.debugLog(' ******** Cell Click ********');
    this.printBasicDiagnosticInfo();
    this.debugLog(event);

    let cell = event.target;
    this.manager.cursor = cell.metadata.byteIndex;
    this.configureAndFillGrid();
  }

  handleWheelEvent(event: any) {
    this.debugLog('[Hexlab] ******** Wheel event ********')
    this.debugLog(event)

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
      this.debugLog('[Hexlab] ERROR bad start position on wheel event');
    }
    this.printBasicDiagnosticInfo();

    // Check the cursor
    let range = this.manager.getPageByteRangeInclusive();
    this.debugLog('[HexLab] CURSOR RANGE CHECK ' + range)
    // If it's not inside the page, put it back inside
    if (!(this.manager.cursor >= range[0] && this.manager.cursor <= range[1])) {
      this.debugLog('[Hexlab]   cursor outside');
      if (event.deltaY < 0) {
        this.debugLog('[Hexlab]   subtract from cursor pos');
        this.debugLog('[HexLab] 1BEFORE ' + this.manager.cursor)
        this.manager.cursor = this.manager.cursor - minDelta;
        this.debugLog('[HexLab] 1AFTER ' + this.manager.cursor)
      } else {
        this.debugLog('[Hexlab]   add to cursor pos');
        this.debugLog('[HexLab] 2BEFORE ' + this.manager.cursor)
        this.manager.cursor = this.manager.cursor + minDelta;
        this.debugLog('[HexLab] 2AFTER ' + this.manager.cursor)
      }
    }

    // The position has been modified, make sure the scrollbar reflects the
    // current position on the grid
    this.scrollbar.setPosition(this.manager.position);

    this.configureAndFillGrid();
  }

  handleScrollGripDragMove(event: any) {
    this.debugLog('[Hexlab] ******** Mouse event! ********');

    // Handles subsequent mouse events until a mouseup
    if (event.type == 'mousemove') {
      this.debugLog('[Hexlab] -- Move event found --')

      let minScroll = this.scrollbar.getMinGripScroll();
      let maxScroll = this.scrollbar.getMaxGripScroll();

      let gripRect = this.scrollGrip.getBoundingClientRect();
      this.debugLog('[Hexlab]   GRIPRECT TOP');
      this.debugLog(gripRect.top);
      let pageY = event.pageY;
      this.debugLog('[Hexlab]   pageY');
      this.debugLog(pageY);
      let gripTop = parseInt(gripRect.top);
      this.debugLog('[Hexlab]   gripTop');
      this.debugLog(gripTop);
      let scrollbarRect = this.scrollbar.node.getBoundingClientRect();
      let scrollHeight = scrollbarRect.height;
      this.debugLog('[Hexlab]   scrollbarHeight');
      this.debugLog(scrollHeight);
      let scrollTop = scrollbarRect.top;
      this.debugLog('[Hexlab]   scrollTop');
      this.debugLog(scrollTop);
      let scrollbarRelative = pageY - scrollTop;
      let clampedPosition = Math.min(Math.max(minScroll, scrollbarRelative), maxScroll);

      // TODO refactor this whole func
      let newGripPosition = clampedPosition;
      this.debugLog('[Hexlab]   NEWGRIP');
      this.debugLog(newGripPosition);

      // let dataPositionAsPercent = clampedPosition / this.getGripScrollRange();
      // this.debugLog('[Hexlab]   DATAPERCENTx');
      // this.debugLog(dataPositionAsPercent);
      // let rawBytePos = (dataPositionAsPercent * this.manager.fileSize) % this.manager.fileSize;
      // let rowIndexForPosition = Math.min(this.manager.getLastDataStartPosition(), Math.floor(rawBytePos / this.manager.maxCellCount));
      // let rowStartByteIndexForPosition = Math.floor(rowIndexForPosition * this.manager.maxCellCount);
      // let clampedRowStartPosition = Math.max(0, Math.min(this.manager.getLastDataStartPosition(), rowStartByteIndexForPosition));

      // this.debugLog('[Hexlab]   rawBytePos');
      // this.debugLog(rawBytePos);
      // this.debugLog('[Hexlab]   clamped row start');
      // this.debugLog(clampedRowStartPosition);

      // Set the data position  // TODO stop using snake case
      let data_position_for_drag = this.scrollbar.setDragPosition(newGripPosition);
      if (!this.manager.isValidRowStartPosition(data_position_for_drag)) {
        console.log('[HexLab] ERROR bad data position for scroll coordinates');
        data_position_for_drag = this.manager.getClosestRowStartForPosition(data_position_for_drag);
      }

      this.manager.position = data_position_for_drag;

      // this.manager.position = clampedRowStartPosition;
      // if (newGripPosition <= this.scrollbar.getMinGripScroll()) {
      //   // A grip top pos, go to byte 0
      //   this.manager.position = 0;
      // } else if (newGripPosition >= this.scrollbar.getMaxGripScroll()) {
      //   // A grip bottom pos, go to last data position (last row start)
      //   this.manager.position = this.manager.getLastDataStartPosition();
      // }
      // let range = this.manager.getPageByteRangeInclusive();
      // if (!(this.manager.position >= range[0] && this.manager.position <= range[1])) {
      //   // TODO this should do a vertical cursor move instead probably?
      //   this.manager.cursor = range[0];
      // }

      // Throttle the grid fill op to once per 100 milliseconds
      let now: any = new Date();
      if ((now - this.lastGridFillTimestamp) > 100) {
        this.configureAndFillGrid();
      }

      // // Set the grip position
      // this.scrollGrip.style.top = newGripPosition.toString() + 'px';
    }
    if (event.type == 'mouseup') {
      this.debugLog('[Hexlab] -- mouseUp found! --')

      // Always fill grid on mouseup to ensure correct ending state
      this.configureAndFillGrid();
      window.removeEventListener('mouseup', this.boundListener, false);
      window.removeEventListener('mousemove', this.boundListener, false);
      this.mouseListenerAttached = false;
    }
  }

  printBasicDiagnosticInfo() {
    this.debugLog('');
    this.debugLog('[Hexlab]   -------- Diagnostic Info --------');
    this.debugLog('[Hexlab]     FileName: ' + this.manager.currentFilename);
    this.debugLog('[Hexlab]     FileSize: ' + this.manager.currentFileSize);
    this.debugLog('[Hexlab]     Data Position: ' + this.manager.currentPosition);
    this.debugLog('[Hexlab]     Cursor: ' + this.manager.cursor);
    this.debugLog('[Hexlab]     lastDataPosition: ' + this.manager.getLastDataStartPosition());
    this.debugLog('[Hexlab]     closestToCursor: ' + this.manager.getClosestRowStartForPosition(this.manager.cursor));
    this.debugLog('[Hexlab]     pageByteRange: ' + this.manager.getPageByteRangeInclusive());
    this.debugLog('[Hexlab]     positionValid: ' + this.manager.isValidRowStartPosition(this.manager.currentPosition));
    this.debugLog('[Hexlab]     positionMultiple: ' + (this.manager.currentPosition % this.manager.getMaxCellCountClamped() == 0));
    this.debugLog('[Hexlab]   --------');
    this.debugLog('[Hexlab]     maxCellCount: ' + this.manager.getMaxCellCountClamped());
    this.debugLog('[Hexlab]     maxRowCount: ' + this.manager.getMaxRowCountClamped());
    this.debugLog('[Hexlab]   --------');
    this.debugLog('[Hexlab]     scrollbarPosition: ' + this.scrollbar.node.style.top);
    this.debugLog('[Hexlab]     scrollbarHeight: ' + this.scrollbar.node.style.height);
    this.debugLog('[Hexlab]     gripMin: ' + this.scrollbar.getMinGripScroll());
    this.debugLog('[Hexlab]     gripMax: ' + this.scrollbar.getMaxGripScroll());
    this.debugLog('[Hexlab]     gripRange: ' + this.getGripScrollRange());
    this.debugLog('[Hexlab]   ------ End Diagnostic Info ------');
    this.debugLog('');
  }

  handleScrollGripDragStart(event: any) {
    this.debugLog('[Hexlab] ******** Scroll grip drag start! ********');
    this.printBasicDiagnosticInfo();
    if(!this.mouseListenerAttached) {
      window.addEventListener('mouseup', this.boundListener, false);
      window.addEventListener('mousemove', this.boundListener, false);
      this.mouseListenerAttached = true;
      this.debugLog('[Hexlab] Attached!');
    }
  }

  alignScrollGripPositionToData() {
    ('[Hexlab] ******** Set scroll grip position ********')
    // Match scrollbar position to the current data position
    // (used after a wheelevent to sync the scrollbar to the new data position)
    this.printBasicDiagnosticInfo();

    if (this.manager.position == this.manager.getLastDataStartPosition()) {
      this.scrollGrip.style.top = this.scrollbar.getMaxGripScroll().toString() + 'px';
      return;
    }
    if (this.manager.position == 0) {
      this.scrollGrip.style.top = this.scrollbar.getMinGripScroll().toString() + 'px';
      return;
    }

    let barPositionPercentOfMax = (this.manager.position / this.manager.fileSize);
    this.debugLog('[Hexlab] CUIRRENTPOS');
    this.debugLog(this.manager.position);
    this.debugLog('[Hexlab] FSIZE');
    this.debugLog(this.manager.fileSize);
    this.debugLog('[Hexlab] PERCENT as decimal');
    this.debugLog(barPositionPercentOfMax);
    this.debugLog('[Hexlab] MAXGRIPSC');
    this.debugLog(this.scrollbar.getMaxGripScroll());
    let desiredGripPositionRaw = barPositionPercentOfMax * (this.scrollbar.getMaxGripScroll() - this.scrollbar.getMinGripScroll());
    this.debugLog('[Hexlab] GRIP RAWx');
    this.debugLog(desiredGripPositionRaw);
    let desiredGripPosition = Math.max(
      Math.min(this.scrollbar.getMaxGripScroll(), desiredGripPositionRaw),
      this.scrollbar.getMinGripScroll()
    )

    this.debugLog('[Hexlab] DESIREDGRIPPOS');
    this.debugLog(desiredGripPosition);

    if (!Number.isNaN(desiredGripPosition)) {
      this.scrollGrip.style.top = desiredGripPosition.toString() + 'px';
    } else {
      this.debugLog('[Hexlab] ERROR NaN grip pos');
    }
  }

  getLastByteIndex() {
    if (this.fileSizeNonZero()) {
      return this.manager.fileSize - 1;
    }
    return 0;
  }

  fileSizeNonZero() {
    // TODO refactor into hex manager
    if (this.manager.fileSize < 1) {
      return false;
    }
    return true;
  }

  // // Keep grid containers, just clear the byte/data values inside the cells
  // wipeCellValues() {
  //   let rowItems = this.hexGrid.children;
  //   for (let rowIndex = 0; rowIndex < rowItems.length; rowIndex++) {
  //     let hexRow = rowItems[rowIndex];

  //     for (let cellIndex = 0; cellIndex < hexRow.children.length; cellIndex++) {  // TODO does a whitespace node show up here?
  //       let cell: any = hexRow.children[cellIndex];
  //       cell.innerText = '';
  //     }
  //   }
  // }

  fillGrid() {
    // Fill the cell grid with user byte content
    this.debugLog('[Hexlab] ******** Fill Grid ********');

    // Do nothing for empty files
    if (this.manager.fileSize < 1) {
      return;
    }

    // Determine how many cells will fit in a row (show a min of 1)
    let maxCellCountClamped = this.manager.getMaxCellCountClamped();

    // Iterate over row/cell containers and populate with data
    let rowItems = this.hexGrid.children;
    for (let rowIndex = 0; rowIndex < rowItems.length; rowIndex++) {
      let hexRow = rowItems[rowIndex];

      for (let cellIndex = 0; cellIndex < hexRow.children.length; cellIndex++) {  // TODO does a whitespace node show up here?
        let cell: any = hexRow.children[cellIndex];

        let byteIndex = this.manager.position + (maxCellCountClamped * rowIndex) + cellIndex;
        if (!(byteIndex < this.manager.fileSize)) {
          this.debugLog('[Hexlab] Stopping at invalid byte index');
          this.debugLog(byteIndex);
          return;
        }
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
          cell.style['background-color'] = '#2fc900';
        }
        if (byteIndex == this.manager.cursor) {
          cell.style['background-color'] = '#c200a8';
        }

        cell.innerText = charmap[left_hex] + charmap[right_hex];
      }
    }

    // TODO Remove/refactor
    // this.alignScrollGripPositionToData();
  }

  // The cell grid holds row containers and cells containers that
  // hold the user's hex data, which are constructed here based on
  // the root container's width. Cells don't actually scroll in
  // the typical sense: They are containers that hold appropriate
  // data for the given view position (the grid always holds a
  // single page of data/cells, note that it may be a partial page
  // if the view position is near the end of the file).
  configureGrid() {
    this.debugLog('[Hexlab] ******** Configure Grid ********');

    // Do nothing for empty files
    if (this.manager.isEmpty()) {
      return;
    }

    // TODO ensure these are deallocated?
    // Remove any existing elements held in the grid
    this.clearGrid();

    // Make the manager aware of the grid space
    this.manager.maxCellCount = this.cellsPerWidth();
    this.manager.maxRowCount = this.rowsPerHeight();

    // Show some basic stats
    this.printBasicDiagnosticInfo();

    // TODO fix this/refactor
    // // Fix the current position (if it's not a multiple of
    // // the current max cell count, make it one)...we use the
    // // closest position to the cursor to attempt to keep the
    // // same place on screen/in-page during hex cell reflow
    // let range = this.manager.getPageByteRangeInclusive();
    // let cursorInvalid = !(this.manager.cursor >= range[0] && this.manager.cursor <= range[1]);
    // if (!this.manager.isValidRowStartPosition(this.manager.position) || cursorInvalid) {
    //   this.debugLog('[Hexlab] CLOSEST ROW FIX');
    //   this.debugLog('[Hexlab]   CURSOR STATS');
    //   this.debugLog(this.manager.cursor);
    //   this.debugLog(this.manager.getClosestRowStartForPosition(this.manager.cursor));
    //   let desiredPosition = this.manager.getClosestRowStartForPosition(this.manager.cursor);
    //   this.manager.position = desiredPosition;
    // }

    // Determine how many row/cell containers will theoretically fit
    // within the page. Note that the user's data may only fill a portion
    // of the theoretical max container count. Also note that, regardless
    // of how skinny or short the page is, these values are clamped to always
    // give at least 1 row and 1 cell (which will clip in extreme cases).
    let maxCellCountClamped = this.manager.getMaxCellCountClamped();
    let maxRowCountClamped = this.manager.getMaxRowCountClamped();

    // Get the range of valid data indices that could fit on the page
    // for the given data position (note that we may not have enough
    // data indices to fill the theoretical max cell count/page size
    // if we're near the end of the user's file)
    let range = this.manager.getPageByteRangeInclusive();

    // Make rows until the file end is reached
    let rowElements: any = [];
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
      // this.debugLog('[Hexlab] Add row for start byte: ' + rowStartPos);

      // The data position at the start of the row is checked to determine
      // whether a new row is needed. Increment the row's data start position
      // by the max cell count (ie 1 row) to determine if another row is needed.
      rowStartPos += maxCellCountClamped;
    }
    this.debugLog('[Hexlab] Actual rows created: ' + rowElements.length);
    if (rowElements.length > maxRowCountClamped) {
       this.debugLog('[Hexlab] ERROR: Actual rows exceeds max ');
    }

    // Add cells to each row until the file end is reached
    for (let rowCount = 0; rowCount < rowElements.length; rowCount++) {
      // this.debugLog('[Hexlab] -- Row Start @ '+ rowCount);
      for (let cellPosition = 0; cellPosition < maxCellCountClamped; cellPosition++) {
        let currentRow = rowElements[rowCount];

        // Get the data position of the hex cell we're going to make (the
        // byte this cell is going to display)
        let bytePosition = this.manager.position + (maxCellCountClamped * rowCount) + cellPosition;
      //  this.debugLog('[Hexlab] BytePosition');
      //  this.debugLog(bytePosition);

        // Add a cell if the position is valid (not past file size bounds)
        if (bytePosition < this.manager.fileSize) {
          // Create the hex cell layout item
          let hexCell: any = document.createElement('div');
          hexCell.classList.add('hexlab_hex_byte');
          hexCell.metadata = {
            byteIndex: bytePosition
          }
          hexCell.addEventListener('click', this.handleCellClick.bind(this));

          // Do any cell post processing here
          if (cellPosition == maxCellCountClamped - 1 || bytePosition == this.manager.fileSize - 1) {
            // this.debugLog('[Hexlab] last cell in row at ' + bytePosition);
            hexCell.style['background-color'] = 'red';
            hexCell.style['margin-right'] = '0px';
          }
          if (bytePosition == this.manager.fileSize - 1) {
            // this.debugLog('[Hexlab] Last file byte! ' + bytePosition);
            hexCell.style['background-color'] = 'blue';
          }

          // Append the cell to the layout row
          currentRow.appendChild(hexCell);
        }
        else {
          this.debugLog('[Hexlab] STOP cell build before byteposition ' + bytePosition);
          break;
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

/**
* Activate the hexlab widget extension.
*/
function activate(app: JupyterFrontEnd, palette: ICommandPalette, restorer: ILayoutRestorer | null) {
  console.log('[Hexlab] JupyterLab extension hexlab is activated!');

  // Declare a widget variable
  let widget: Panel;

  // Add an application command
  const command: string = 'hexlab:open';
  app.commands.addCommand(command, {
    label: 'Hex Editor',
    execute: () => {
      if (!widget || widget.isDisposed) {
        const content = new HexEditorWidget();
        widget = new Panel();
        widget.addWidget(content);
        widget.id = 'hexlab';
        widget.title.label = 'Hex Editor';
        widget.title.closable = true;
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.add(widget, 'right');
      }

      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({ command, category: 'Tutorial' });

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
  autoStart: true,
  requires: [ICommandPalette],
  optional: [ILayoutRestorer],
  activate: activate,
};

export default plugin;
