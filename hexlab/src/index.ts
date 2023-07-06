import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker
} from '@jupyterlab/apputils';

import { Widget } from '@lumino/widgets';

//import ResizeObserver from 'resize-observer-polyfill';

function getScrollbar() {
  let scrollbar = document.createElement('div');
  scrollbar.classList.add('hexlab_scrollbar');

  let scrollGrip = document.createElement('div');
  scrollGrip.classList.add('hexlab_scroll_grip');
  scrollbar.appendChild(scrollGrip);

  return scrollbar;
}

class HexEditorWidget extends Widget {
  /**
  * TODO: Add docsxy
  */

  mainArea: HTMLElement;
  workspace: HTMLElement;
  topArea: HTMLElement;
  openButton: any;
  openInputHidden: any;
  fileLabel: any;
  hexGrid: HTMLElement;
  scrollbar: any;
  scrollGrip: any;
  mouseListenerAttached = false;
  boundListener: any;
  lastGridFillTimestamp: any = new Date();
  DEBUG = true;

  gridResizeChecker: any;

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
  cursor = 0;

  constructor() {
    super();

    // Initialize data members
    this.currentFilename = null;
    this.currentBlobData = null;
    this.currentFileSize = 0;
    this.currentPosition = 0;

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
    this.openInputHidden.addEventListener('input' , this.openFile.bind(this), {passive: true});
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
    this.scrollbar = getScrollbar();
    this.scrollGrip = this.scrollbar.querySelector('.hexlab_scroll_grip');
    this.boundListener = this.handleScrollGripDragMove.bind(this)
    this.scrollGrip.addEventListener('mousedown', this.handleScrollGripDragStart.bind(this));
    this.workspace.appendChild(this.hexGrid);
    this.workspace.appendChild(this.scrollbar);

    this.configureAndFillGrid();
    this.node.addEventListener('wheel', this.handleWheelEvent.bind(this));
  }

  debugLog(message: any) {
    if (this.DEBUG) {
      console.log(message)
    }
  }

  triggerFileDialog() {
    this.openInputHidden.click();
  }

  async openFile() {
    console.log('[HexLab] ******** Opening File ********');

    // Trigger the <input> element to get a file dialog
    this.debugLog('[Hexlab] Input elem');
    this.debugLog(this.openInputHidden);
    this.openInputHidden.click();

    // Clear/empty current hex grid
    this.hexGrid.innerText = '';

    // Clear stored file metadata and attempt to re-populate
    this.currentFilename = null;
    this.currentFileSize = 0;
    this.currentPosition = 0;
    this.scrollbar.style.top = this.getMinGripScroll().toString() + 'px';
    this.fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';

    // Attempt to get file contents
    try {
      this.debugLog('[Hexlab] File list');
      this.debugLog(this.openInputHidden.files);
      const fileData = this.openInputHidden.files[0];
      let binRaw = await fileData.arrayBuffer();
      let binData = new Uint8Array(binRaw);

      // Populate binary data members for this file
      this.currentFilename = fileData.name;
      this.fileLabel.innerText = 'File: ' + this.currentFilename;
      this.currentBlobData = binData;
      this.currentFileSize = fileData.size;

      console.log('[Hexlab] Filename: ' + this.currentFilename);
      console.log('[Hexlab] File Size: ' + this.currentFileSize);

      console.log('[Hexlab] File opened successfully');
    } catch (err) {
      console.log('[Hexlab] Unkown error opening file');
    } finally {
      if (this.currentFilename == null) {
        console.log('[Hexlab] File open failed');
        return;
      }
    }

    this.configureAndFillGrid();
  }

  getMinGripScroll() {
    // Grip position setting uses the top of the grip rect,
    // so we only need to leave space for the grip margin
    let GRIP_MARGIN = 2;

    let minScrollInScrollbarRelativeCoords = GRIP_MARGIN;
    return minScrollInScrollbarRelativeCoords;
  }

  getMaxGripScroll() {
    // Grip position setting uses the top of the grip rect,
    // so we need to leave space for the whole grip circle +
    // the grip margin at the bottom so it doesn't overflow
    // the scrollbar
    let scrollbarRect = this.scrollbar.getBoundingClientRect();

    let scrollHeight = parseInt(scrollbarRect.height);

    let GRIP_EDGE_SIZE = 8;
    let GRIP_MARGIN = 2;

    let maxScrollInScrollbarRelativeCoords = scrollHeight - GRIP_EDGE_SIZE - GRIP_MARGIN;
    return maxScrollInScrollbarRelativeCoords;
  }

  getGripScrollRange() {
    // In scrollbar relative coords
    return this.getMaxGripScroll() - this.getMinGripScroll();
  }

  handleGridResize() {
    this.debugLog('[Hexlab] ******** GRID RESIZE ********');
    this.configureAndFillGrid();
  }

  handleCellClick(event: any) {
    this.debugLog(' ******** Cell Click ********');
    this.printBasicDiagnosticInfo();
    this.debugLog(event);

    let cell = event.target;
    this.cursor = cell.metadata.byteIndex;
    this.configureAndFillGrid();
  }

  handleWheelEvent(event: any) {
    this.debugLog('[Hexlab] ******** Wheel event ********')
    this.debugLog(event)
    let minDelta = this.getMaxCellCount();
    let lastScrollPosition = this.getLastDataStartPosition();
    this.printBasicDiagnosticInfo();

    // Check for up/down movement and respond accordingly
    if (event.deltaY < 0) {
      this.currentPosition = Math.max(0, this.currentPosition - minDelta);
    } else {
      this.currentPosition = Math.min(lastScrollPosition, this.currentPosition + minDelta);
    }
    if (!this.isValidRowStartPosition(this.currentPosition)) {
      // Shouldn't be necessary
      this.currentPosition = this.getClosestRowStartForPosition(this.currentPosition);
      this.debugLog('[Hexlab] ERROR bad start position on wheel event');
    }
    this.printBasicDiagnosticInfo();

    // Check the cursor
    let range = this.getPageByteRangeInclusive();
    if (!(this.cursor >= range[0] && this.cursor <= range[1])) {
      this.debugLog('[Hexlab]   cursor outside');
      if (event.deltaY < 0) {
        this.debugLog('[Hexlab]   subtract from cursor pos');
        this.cursor -= this.getMaxCellCount();
        this.cursor = Math.max(0, this.cursor);
      } else {
        this.debugLog('[Hexlab]   add to cursor pos');
        this.cursor += this.getMaxCellCount();
        this.cursor = Math.max(0, Math.min(this.currentFileSize - 1, this.cursor));
      }
    }

    this.configureAndFillGrid();
  }

  handleScrollGripDragMove(event: any) {
    this.debugLog('[Hexlab] ******** Mouse event! ********');

    // Handles subsequent mouse events until a mouseup
    if (event.type == 'mousemove') {
      this.debugLog('[Hexlab] -- Move event found --')

      let minScroll = this.getMinGripScroll();
      let maxScroll = this.getMaxGripScroll();

      let gripRect = this.scrollGrip.getBoundingClientRect();
      this.debugLog('[Hexlab]   GRIPRECT TOP');
      this.debugLog(gripRect.top);
      let pageY = event.pageY;
      this.debugLog('[Hexlab]   pageY');
      this.debugLog(pageY);
      let gripTop = parseInt(gripRect.top);
      this.debugLog('[Hexlab]   gripTop');
      this.debugLog(gripTop);
      let scrollbarRect = this.scrollbar.getBoundingClientRect();
      let scrollHeight = parseInt(scrollbarRect.height);
      this.debugLog('[Hexlab]   scrollbarHeight');
      this.debugLog(scrollHeight);
      let scrollTop = parseInt(scrollbarRect.top);
      this.debugLog('[Hexlab]   scrollTop');
      this.debugLog(scrollTop);
      let scrollbarRelative = pageY - scrollTop;
      let clampedPosition = Math.min(Math.max(minScroll, scrollbarRelative), maxScroll);

      let newGripPosition = clampedPosition;
      this.debugLog('[Hexlab]   NEWGRIP');
      this.debugLog(newGripPosition);

      let dataPositionAsPercent = clampedPosition / this.getGripScrollRange();
      this.debugLog('[Hexlab]   DATAPERCENTx');
      this.debugLog(dataPositionAsPercent);
      let rawBytePos = (dataPositionAsPercent * this.currentFileSize) % this.currentFileSize;
      let rowIndexForPosition = Math.min(this.getLastDataStartPosition(), Math.floor(rawBytePos / this.getMaxCellCount()));
      let rowStartByteIndexForPosition = Math.floor(rowIndexForPosition * this.getMaxCellCount());
      let clampedRowStartPosition = Math.max(0, Math.min(this.getLastDataStartPosition(), rowStartByteIndexForPosition));

      this.debugLog('[Hexlab]   rawBytePos');
      this.debugLog(rawBytePos);
      this.debugLog('[Hexlab]   clamped row start');
      this.debugLog(clampedRowStartPosition);

      // Set the data position
      this.currentPosition = clampedRowStartPosition;
      if (newGripPosition <= this.getMinGripScroll()) {
        // A grip top pos, go to byte 0
        this.currentPosition = 0;
      } else if (newGripPosition >= this.getMaxGripScroll()) {
        // A grip bottom pos, go to last data position (last row start)
        this.currentPosition = this.getLastDataStartPosition();
      }
      let range = this.getPageByteRangeInclusive();
      if (!(this.currentPosition >= range[0] && this.currentPosition <= range[1])) {
        // TODO this should do a vertical cursor move instead probably?
        this.cursor = range[0];
      }

      // Throttle the grid fill op to once per 60 milliseconds
      let now: any = new Date();
      if ((now - this.lastGridFillTimestamp) > 60) {
        this.configureAndFillGrid();
      }

      // Set the grip position
      this.scrollGrip.style.top = newGripPosition.toString() + 'px';
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
    this.debugLog('[Hexlab]   -------- Diagnostic Info --------');
    this.debugLog('[Hexlab]     FileName: ' + this.currentFilename);
    this.debugLog('[Hexlab]     FileSize: ' + this.currentFileSize);
    this.debugLog('[Hexlab]     Data Position: ' + this.currentPosition);
    this.debugLog('[Hexlab]     Cursor: ' + this.cursor);
    this.debugLog('[Hexlab]     lastDataPosition: ' + this.getLastDataStartPosition());
    this.debugLog('[Hexlab]     closestToCursor: ' + this.getClosestRowStartForPosition(this.cursor));
    this.debugLog('[Hexlab]     pageByteRange: ' + this.getPageByteRangeInclusive());
    this.debugLog('[Hexlab]     positionValid: ' + this.isValidRowStartPosition(this.currentPosition));
    this.debugLog('[Hexlab]     positionMultiple: ' + (this.currentPosition % this.getMaxCellCount() == 0));
    this.debugLog('[Hexlab]   --------');
    this.debugLog('[Hexlab]     maxCellCount: ' + this.getMaxCellCount());
    this.debugLog('[Hexlab]     maxRowCount: ' + this.getMaxRowCount());
    this.debugLog('[Hexlab]   --------');
    this.debugLog('[Hexlab]     scrollbarPosition: ' + this.scrollbar.style.top);
    this.debugLog('[Hexlab]     scrollbarHeight: ' + this.scrollbar.style.height);
    this.debugLog('[Hexlab]     gripMin: ' + this.getMinGripScroll());
    this.debugLog('[Hexlab]     gripMax: ' + this.getMaxGripScroll());
    this.debugLog('[Hexlab]     gripRange: ' + this.getGripScrollRange());
    this.debugLog('[Hexlab]   ------ End Diagnostic Info ------');
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

    if (this.currentPosition == this.getLastDataStartPosition()) {
      this.scrollGrip.style.top = this.getMaxGripScroll().toString() + 'px';
      return;
    }
    if (this.currentPosition == 0) {
      this.scrollGrip.style.top = this.getMinGripScroll().toString() + 'px';
      return;
    }

    let barPositionPercentOfMax = (this.currentPosition / this.currentFileSize);
    this.debugLog('[Hexlab] CUIRRENTPOS');
    this.debugLog(this.currentPosition);
    this.debugLog('[Hexlab] FSIZE');
    this.debugLog(this.currentFileSize);
    this.debugLog('[Hexlab] PERCENT as decimal');
    this.debugLog(barPositionPercentOfMax);
    this.debugLog('[Hexlab] MAXGRIPSC');
    this.debugLog(this.getMaxGripScroll());
    let desiredGripPositionRaw = barPositionPercentOfMax * (this.getMaxGripScroll() - this.getMinGripScroll());
    this.debugLog('[Hexlab] GRIP RAWx');
    this.debugLog(desiredGripPositionRaw);
    let desiredGripPosition = Math.max(
      Math.min(this.getMaxGripScroll(), desiredGripPositionRaw),
      this.getMinGripScroll()
    )

    this.debugLog('[Hexlab] DESIREDGRIPPOS');
    this.debugLog(desiredGripPosition);

    if (!Number.isNaN(desiredGripPosition)) {
      this.scrollGrip.style.top = desiredGripPosition.toString() + 'px';
    } else {
      this.debugLog('[Hexlab] ERROR NaN grip pos');
    }
  }

  getMaxCellCount() {
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

  getMaxRowCount() {
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

  getLastDataStartPosition() {
  // The last data position users can scroll to (last row start)

    // Return for empty files
    if (this.currentFileSize < 1) {
      return 0;
    }

    // Actual width may be less than 1 cell wide, do min of 1
    // (1 hex cell with overflow is min display behavior)
    let maxCellCountModified = Math.max(1, this.getMaxCellCount());

    // Get total num rows needed (including any partial row)
    let totalRowCount = Math.ceil(this.currentFileSize / maxCellCountModified);

    let lastPosition = Math.max(0, (totalRowCount - 1)) * maxCellCountModified;

    return lastPosition;
  }

  getPageByteRangeInclusive() {
    // Gets min/max POSITIONS (indices) of bytes on the page
    // (if there's a partial row, end should be last byte index)
    // Note: This is all byte positions showable on the page,
    // does not include indices past current end of file
    if (this.currentFileSize < 1) {
      return [0, 0];
    }

    let start = this.currentPosition;

    let maxCellCount = this.getMaxCellCount()
    let maxRowCount = this.getMaxRowCount()
    let maxCellCountModified = Math.max(maxCellCount, 1);
    let maxRowCountModified = Math.max(maxRowCount, 1);

    // Max end byte on at this position is at most [page size] bytes from position
    let lastByteForPageSize = this.currentPosition + (maxCellCountModified * maxRowCountModified) - 1;

    // We may be near the end of the file with partial/absent rows
    let end = lastByteForPageSize;
    if (!(end < this.currentFileSize)) {
      end = Math.max(0, this.currentFileSize - 1);
    }

    return [start, end];
  }

  isValidRowStartPosition(position: number) {
    if (position % this.getMaxCellCount() == 0) {
      return true;
    }
    return false;
  }

  getLastByteIndex() {
    if (this.fileSizeNonZero()) {
      return this.currentFileSize - 1;
    }
    return 0;
  }

  fileSizeNonZero() {
    if (this.currentFileSize < 1) {
      return false;
    }
    return true;
  }

  getClosestRowStartForPosition(position: number) {
    let maxCellCountModified = Math.max(1, this.getMaxCellCount());  // TODO conv func

    // Any index past the file bounds goes to last valid row start position
    if (position > this.getLastDataStartPosition()) {
      return this.getLastDataStartPosition();
    }

    let byteCountForPosition = position + 1;
    let rowsNeededForPosition = Math.ceil(byteCountForPosition / maxCellCountModified);
    let closestRowStartBytePosition = (rowsNeededForPosition * maxCellCountModified) - maxCellCountModified;

    return closestRowStartBytePosition;
  }

  fillGrid() {
    this.debugLog('[Hexlab] ******** Fill Grid ********');
    let maxCellCountModified = Math.max(this.getMaxCellCount(), 1);

    let rowItems = this.hexGrid.children;
    for (let rowIndex = 0; rowIndex < rowItems.length; rowIndex++) {
      let hexRow = rowItems[rowIndex];

      for (let cellIndex = 0; cellIndex < hexRow.children.length; cellIndex++) {  // TODO does a whitespace node show up here?
        let cell: any = hexRow.children[cellIndex];

        let byteIndex = this.currentPosition + (maxCellCountModified * rowIndex) + cellIndex;
        if (!(byteIndex < this.currentFileSize)) {
          this.debugLog('[Hexlab] ERROR BAD BYTE INDEX');
          this.debugLog(byteIndex);
          return;
        }
        let currentByte = this.currentBlobData![byteIndex];

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
        if (byteIndex == this.cursor) {
          cell.style['background-color'] = '#c200a8';
        }

        cell.innerText = charmap[left_hex] + charmap[right_hex];
      }
    }

    this.alignScrollGripPositionToData();
  }

  configureGrid() {
    this.debugLog('[Hexlab] ******** Configure Grid ********');

    this.hexGrid.innerText = '';  // Empty the element
    while (this.hexGrid.firstChild != null) {
      this.hexGrid.removeChild(this.hexGrid.lastChild!);
    }

    // Do not populate for empty files
    if (this.currentFileSize < 1) {
      return;
    }

    // Show some basic stats
    this.printBasicDiagnosticInfo();

    // Fix the current position (if it's not a multiple of
    // the current max cell count, make it one)...we use the
    // closest position to the cursor to attempt to keep the
    // same place on screen/in-page during hex cell reflow
    let range = this.getPageByteRangeInclusive();
    if (!this.isValidRowStartPosition(this.currentPosition) || !(this.cursor >= range[0] && this.cursor <= range[1])) {
      this.debugLog('[Hexlab] CLOSEST ROW FIX');
      this.debugLog('[Hexlab]   CURSOR STATS');
      this.debugLog(this.cursor);
      this.debugLog(this.getClosestRowStartForPosition(this.cursor));
      let desiredPosition = this.getClosestRowStartForPosition(this.cursor);
      this.currentPosition = desiredPosition;
    }

    // Get theoretical max cell/row count for this page size
    let maxCellCount = this.getMaxCellCount();
    let maxRowCount = this.getMaxRowCount();
    // If the file is non-empty, but the page is too
    // small to show even a single row/column, show
    // a single row/column/cell anyway and let it overflow
    let maxCellCountModified = Math.max(maxCellCount, 1);
    let maxRowCountModified = Math.max(maxRowCount, 1);

    // Make rows until the file end is reached
    let rowElements: any = [];
    let rowStartPos = this.currentPosition;
    while (rowStartPos <= range[1]) {
      // Make a row container that holds the bytes for that row
      let hexRow: any = document.createElement('div');
      hexRow.classList.add('hexlab_hex_row');
      hexRow.metadata = {
        byteIndex: rowStartPos,
        containerIndex: rowElements.length
      }

      this.hexGrid.appendChild(hexRow);
      rowElements.push(hexRow);
      this.debugLog('[Hexlab] Add row for start byte: ' + rowStartPos);

      rowStartPos += maxCellCountModified;
    }
    this.debugLog('[Hexlab] Actual rows created: ' + rowElements.length);
    if (rowElements.length > maxRowCountModified) {
       this.debugLog('[Hexlab] ERROR: Actual rows exceeds max ');
    }

    // Add cells to each row until the file end is reached
    for (let rowCount = 0; rowCount < rowElements.length; rowCount++) {
      this.debugLog('[Hexlab] -- Row Start @ '+ rowCount);
      for (let cellPosition = 0; cellPosition < maxCellCountModified; cellPosition++) {
        let currentRow = rowElements[rowCount];

        // Get the position of the hex cell we're going to make
        let bytePosition = this.currentPosition + (maxCellCountModified * rowCount) + cellPosition;
//        this.debugLog('[Hexlab] BytePosition');
//        this.debugLog(bytePosition);

        // Add a cell if the position is valid (not past file size bounds)
        if (bytePosition < this.currentFileSize) {
          // Create the hex cell layout item
          let hexCell: any = document.createElement('div');
          hexCell.classList.add('hexlab_hex_byte');
          hexCell.metadata = {
            byteIndex: bytePosition,
            containerIndex: cellPosition,
          }
          hexCell.addEventListener('click', this.handleCellClick.bind(this));

          // Do any cell post processing here
          if (cellPosition == maxCellCountModified - 1 || bytePosition == this.currentFileSize - 1) {
            this.debugLog('[Hexlab] last cell in row at ' + bytePosition);
            hexCell.style['background-color'] = 'red';
            hexCell.style['margin-right'] = '0px';
          }
          if (bytePosition == this.currentFileSize - 1) {
            this.debugLog('[Hexlab] Last file byte! ' + bytePosition);
            hexCell.style['background-color'] = 'blue';
          }

          // Append the cell to the layout row
          currentRow.appendChild(hexCell);
        }
        else {
          this.debugLog('[Hexlab] BREAK on byteposition ' + bytePosition);
          break;
        }
      }
    }

    this.fillGrid();
  }

  configureAndFillGrid() {
    this.lastGridFillTimestamp = new Date();
    this.configureGrid();
    if (this.currentFileSize > 0) {
      this.fillGrid();
    }
  }
}

/**
* Activate the hexlab widget extension.
*/
function activate(app: JupyterFrontEnd, palette: ICommandPalette, restorer: ILayoutRestorer | null) {
  console.log('[Hexlab] JupyterLab extension hexlab is activated!');

  // Declare a widget variable
  let widget: MainAreaWidget<HexEditorWidget>;

  // Add an application command
  const command: string = 'hexlab:open';
  app.commands.addCommand(command, {
    label: 'Hex Editor',
    execute: () => {
      if (!widget || widget.isDisposed) {
        const content = new HexEditorWidget();
        widget = new MainAreaWidget({content});
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
        app.shell.add(widget, 'main');
      }

      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({ command, category: 'Tutorial' });

  // Track and restore the widget state
  let tracker = new WidgetTracker<MainAreaWidget<HexEditorWidget>>({
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
