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

import ResizeObserver from 'resize-observer-polyfill';

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

  gridResizeChecker: any;

  currentBlobData: Uint8Array | null;
  currentFilename: string | null;
  currentFileSize: number;
  currentPosition: number;

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
    this.gridResizeChecker = new ResizeObserver(this.configureAndFillGrid.bind(this));
    this.gridResizeChecker.observe(this.workspace);
    this.mainArea.appendChild(this.workspace);

    // Define a grid with slots to hold byte content
    this.hexGrid = document.createElement('div');
    this.hexGrid.classList.add('hexlab_hex_grid');
    this.hexGrid.classList.add('--jp-code-font-family');
    this.hexGrid.classList.add('--jp-code-font-size');
    console.log(this.hexGrid);

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
    this.node.addEventListener('wheel', this.handleScrollEvent.bind(this));
  }

  triggerFileDialog() {
    this.openInputHidden.click();
  }

  async openFile() {
    console.log('[HexLab] Opening File');

    console.log('INPUTELEM');
    console.log(this.openInputHidden);
    this.openInputHidden.click();

    // Clear/empty current hex grid
    this.hexGrid.innerText = '';

    // Clear stored file metadata and attempt to re-populate
    this.currentFilename = null;
    this.currentFileSize = 0;
    this.currentPosition = 0;
    this.scrollbar.style.top = this.getMinGripScroll().toString() + 'px';
    this.fileLabel.innerHTML = '&lt;<i>No File</i>&gt;';
    try {
      console.log('FILELIST');
      console.log(this.openInputHidden.files);
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
      console.log('[Hexlab] Error opening file');
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

  handleScrollGripDragMove(event: any) {
    console.log('[Hexlab] Mouse event!');

    // Handles subsequent mouse events until a mouseup
    if (event.type == 'mousemove') {
      console.log('[Hexlab] Move')

      let minScroll = this.getMinGripScroll();
      let maxScroll = this.getMaxGripScroll();

      console.log('MOVETRACE');
      let gripRect = this.scrollGrip.getBoundingClientRect();
      console.log('  GRIPRECT TOP');
      console.log(gripRect.top);
      let pageY = event.pageY;
      console.log('  pageY');
      console.log(pageY);
      let gripTop = parseInt(gripRect.top);
      console.log('  gripTop');
      console.log(gripTop);
      let scrollbarRect = this.scrollbar.getBoundingClientRect();
      let scrollHeight = parseInt(scrollbarRect.height);
      console.log('  scrollbarHeight');
      console.log(scrollHeight);
      let scrollTop = parseInt(scrollbarRect.top);
      console.log('  scrollTop');
      console.log(scrollTop);
      let scrollbarRelative = pageY - scrollTop;
      let clampedPosition = Math.min(Math.max(minScroll, scrollbarRelative), maxScroll);

      let newGripPosition = clampedPosition;
      console.log('  NEWGRIP');
      console.log(newGripPosition);

      let rawBytePos = Math.floor((clampedPosition / this.getGripScrollRange()) * this.currentFileSize);
      let rowPosition = Math.min(this.getLastScrollPosition(), Math.floor(rawBytePos / this.getMaxCellCount()));
      let closestRowPosition = Math.min(this.getLastScrollPosition(), Math.floor(rowPosition * this.getMaxCellCount()));

      console.log('  rawBytePos');
      console.log(rawBytePos);
      console.log('  rowPos');
      console.log(rowPosition);

      // Set the data position
      this.currentPosition = closestRowPosition;
      if (newGripPosition == this.getMinGripScroll()) {
        this.currentPosition = 0;
      } else if (newGripPosition == this.getMaxGripScroll()) {
        this.currentPosition = this.getLastScrollPosition();
      }

      // Throttle the grid fill op to once per 80 milliseconds
      let now: any = new Date();
      if ((now - this.lastGridFillTimestamp) > 60) {
        this.configureAndFillGrid();
      }

      // Set the grip position
      this.scrollGrip.style.top = newGripPosition.toString() + 'px';
    }
    if (event.type == 'mouseup') {
      console.log('[Hexlab] UP/DISCONNECT')

      // Always fill grid on mouseup to ensure correct ending state
      this.configureAndFillGrid();
      window.removeEventListener('mouseup', this.boundListener, false);
      window.removeEventListener('mousemove', this.boundListener, false);
      this.mouseListenerAttached = false;
    }
  }

  handleScrollGripDragStart(event: any) {
    console.log('[Hexlab] Scroll grip drag start!');
    if(!this.mouseListenerAttached) {
      window.addEventListener('mouseup', this.boundListener, false);
      window.addEventListener('mousemove', this.boundListener, false);
      this.mouseListenerAttached = true;
      console.log('[Hexlab] Attached!');
    }
  }

  getLastScrollPosition() {
    // The last data position users can scroll to (last row start)
    return this.currentFileSize - (this.currentFileSize % this.getMaxCellCount());
  }

  handleScrollEvent(event: any) {
    console.log('[Hexlab] WHEEL EVENT')
    console.log(event)
    let minDelta = this.getMaxCellCount();

    if (event.deltaY < 0) {
      this.currentPosition = Math.max(0, this.currentPosition - minDelta);
    } else {
      let lastScrollPosition = this.getLastScrollPosition();
      this.currentPosition = Math.min(lastScrollPosition, this.currentPosition + minDelta);
    }

    this.configureAndFillGrid();
  }

  getMaxCellCount() {
    let CELLROWMARGIN = 8;  // TODO refactor these values

    // Determines how many cells can fit in the hex area width
    let gridWidthRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('width');
    gridWidthRaw.replace('p', '');
    gridWidthRaw.replace('x', '');
    let gridWidth: number = parseInt(gridWidthRaw) - (2 * CELLROWMARGIN);

    let CELL_WIDTH =  20;  // TODO refactor these values
    let CELL_MARGIN = 8;
    return Math.floor(
      ((gridWidth - CELL_MARGIN) / (CELL_MARGIN + CELL_WIDTH))
    )
  }

  getMaxRowCount() {
    let CELLROWMARGIN = 8;

    // Determines how many rows can fit in the hex area height
    let gridHeightRaw: string = window.getComputedStyle(this.workspace).getPropertyValue('height');
    gridHeightRaw.replace('p', '');
    gridHeightRaw.replace('x', '');
    let gridHeight: number = parseInt(gridHeightRaw) - (2 * CELLROWMARGIN);

    let CELL_WIDTH =  20;
    let CELL_MARGIN = 8;
    return Math.max(
      Math.floor(
        ((gridHeight - CELL_MARGIN) / (CELL_MARGIN + CELL_WIDTH))
      )
    )
  }

  fillGrid() {
    let maxCellCount = this.getMaxCellCount();
    if (this.currentFileSize > 0) {
      // If the file is non-empty, show at least 1 cell even if page too narrow
      maxCellCount = Math.max(this.getMaxCellCount(), 1)
    }

    let rowItems = this.hexGrid.children;
    for (let rowIndex = 0; rowIndex < rowItems.length; rowIndex++) {
      let hexRow = rowItems[rowIndex];

      for (let cellIndex = 0; cellIndex < hexRow.children.length; cellIndex++) {  // TODO does a whitespace node show up here?
        let cell: any = hexRow.children[cellIndex];

        let byteIndex = this.currentPosition + (maxCellCount * rowIndex) + cellIndex;
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
          cell.style['background-color'] = 'green';
        }
        if (cellIndex == rowItems.length - 1) {
          cell.style['margin-right'] = '0';
        }

        cell.innerText = charmap[left_hex] + charmap[right_hex];
      }
    }

    this.setScrollGripPosition();
  }

  setScrollGripPosition() {
    // Match scrollbar position to the current data position
    let barPositionPercentOfMax = (this.currentPosition / this.currentFileSize);
    console.log('PERCENT');
    console.log(barPositionPercentOfMax);
    let desiredGripPositionRaw = Math.floor(barPositionPercentOfMax * this.getMaxGripScroll());
    console.log('GRIP RAW');
    console.log(desiredGripPositionRaw);
    let desiredGripPosition = Math.max(
      Math.min(this.getMaxGripScroll(), desiredGripPositionRaw),
      this.getMinGripScroll()
    )

    console.log('DESIREDGRIPPOS');
    console.log(desiredGripPosition);

    if (desiredGripPosition != NaN) {
      this.scrollGrip.style.top = desiredGripPosition.toString() + 'px';
    }
  }

  configureGrid() {

    console.log('[Hexlab] FILL GRID');

    this.hexGrid.innerText = '';  // Empty the element
    while (this.hexGrid.firstChild != null) {
      this.hexGrid.removeChild(this.hexGrid.lastChild!);
    }

    let maxCellCount = this.getMaxCellCount();
    let maxRowCount = this.getMaxRowCount();
    if (this.currentFileSize > 0) {
      maxCellCount = Math.max(this.getMaxCellCount(), 1);
      maxRowCount = Math.max(maxRowCount, 1);
    } else {
      // Don't fill/populate the grid for empty files
      return;
    }
    console.log('[Hexlab] Cell count: ' + maxCellCount);
    console.log('[Hexlab] Row count: ' + maxRowCount);
    console.log('[Hexlab] Position: ' + this.currentPosition);

    // End of file will mean some rows are omitted near the end, and possibly a partial row
    let remaining_bytes = this.currentFileSize - this.currentPosition;
    let rows_needed = Math.ceil(remaining_bytes / maxCellCount);
    if (this.currentFileSize > 0) {
      rows_needed = Math.max(1, Math.ceil(remaining_bytes / maxCellCount))
    }
    let rowCountForCurrentPosition = Math.min(rows_needed, maxRowCount);

    // Build hex layout/dom structure
    let rowItems = []
    for (let rowIndex = 0; rowIndex < rowCountForCurrentPosition; rowIndex++) {
      // Make a row container that holds the bytes for that row
      let hexRow = document.createElement('div');
      hexRow.classList.add('hexlab_hex_row');
      this.hexGrid.appendChild(hexRow);
      rowItems.push(hexRow);

      // Make hex cells (holds 1 byte of our bin data)
      let rowBeginDataPosition = (maxCellCount * (rowIndex)) + this.currentPosition;
      let cellCountThisRow = maxCellCount;
      if (this.currentFileSize - rowBeginDataPosition < maxCellCount) {
        cellCountThisRow = this.currentFileSize - rowBeginDataPosition;
      }
      console.log('[Hexlab] Calculated cell count: ' + cellCountThisRow);

      // Add needed hex cell elements
      for (let j = 0; j < cellCountThisRow; j++) {
        let hexCell: any = document.createElement('div');
        if (j == cellCountThisRow - 1) {
          hexCell.style['background-color'] = 'red';
          hexCell.style['margin-right'] = '0px';
        }
        hexCell.classList.add('hexlab_hex_byte');
        hexRow.appendChild(hexCell);
      }
    }
    console.log('[Hexlab] Actual rows: ' + rowItems.length);

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
  console.log('[Hexlab] JupyterLab extension hexlab is activated!yy9');

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
