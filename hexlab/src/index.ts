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

class HexEditorWidget extends Widget {
  /**
  * TODO: Add docsxy
  */

  rootContainer: HTMLElement;
  hexGridArea: HTMLElement;
  hexContent: HTMLElement;
  topArea: HTMLElement;
  fileLabel: any;
  openButton: any;
  openInputHidden: any;
//  gridResizeChecker: any;

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
    this.addClass('hexlab_root_widget');

    // Build layout subtree
    // ....................
    // Add a root element into the jupyter-widget (full hex UI fits in here)
    this.rootContainer = document.createElement('div');
    this.rootContainer.classList.add('hexlab_root_container');
    this.node.appendChild(this.rootContainer);

    let topArea = document.createElement('div');
    topArea.classList.add('--jp-code-font-family');
    topArea.classList.add('--jp-code-font-size');
    topArea.classList.add('hexlab_top_area');
    this.rootContainer.appendChild(topArea);
    this.topArea = topArea;

    // Set up some controls at the top of the layout
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

    let fileLabel = document.createElement('div');
    fileLabel.classList.add('hexlab_file_label');
    topArea.appendChild(fileLabel);
    this.fileLabel = fileLabel;

    // Define a container for the hex area
    this.hexGridArea = document.createElement('div');
    this.hexGridArea.classList.add('hexlab_hex_grid_area');
//    this.gridResizeChecker = new ResizeObserver(this.foobarwik.bind(this));
//    this.gridResizeChecker.observe(this.hexGridArea);
    this.rootContainer.appendChild(this.hexGridArea);

    // Define a grid with slots to hold byte content
    this.hexContent = document.createElement('div');
    this.hexContent.classList.add('hexlab_hex_content');
    this.hexContent.classList.add('--jp-code-font-family');
    this.hexContent.classList.add('--jp-code-font-size');
    console.log(this.hexContent);
    this.hexGridArea.appendChild(this.hexContent);

    this.configureAndFillGrid();
    this.node.addEventListener('wheel', this.handleScrollEvent.bind(this));
  }

  triggerFileDialog() {
    this.openInputHidden.click();
  }

  foobarwik(thing: any, thing2: any) {
    this.configureAndFillGrid();
  }

  async openFile() {
    console.log('[HexLab] Opening File');

    console.log('INPUTELEM');
    console.log(this.openInputHidden);
    this.openInputHidden.click();

    // Clear/empty current hex grid
    this.hexContent.innerText = '';

    // Clear stored filename and attempt to re-populate
    this.currentFilename = null;
    this.currentFileSize = -1;
    try {
//      let [fileHandle] = await window.showOpenFilePicker();
//      const fileData = await fileHandle.getFile();
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

  getLastScrollPosition() {
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
    let CELLROWMARGIN = 8;

    // Determines how many cells can fit in the hex area width
    let gridWidthRaw: string = window.getComputedStyle(this.hexGridArea).getPropertyValue('width');
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
    let gridHeightRaw: string = window.getComputedStyle(this.hexGridArea).getPropertyValue('height');
    gridHeightRaw.replace('p', '');
    gridHeightRaw.replace('x', '');
    let gridHeight: number = parseInt(gridHeightRaw) - (2 * CELLROWMARGIN);

    let CELL_WIDTH =  20;
    let CELL_MARGIN = 8;
    return Math.max(
      1,
      Math.floor(
        ((gridHeight - CELL_MARGIN) / (CELL_MARGIN + CELL_WIDTH))
      )
    )
  }

  configureAndFillGrid() {
    console.log('[Hexlab] FILL GRID');

    this.hexContent.innerText = '';  // Empty the element
    while (this.hexContent.firstChild != null) {
      this.hexContent.removeChild(this.hexContent.lastChild!);
    }

    let maxCellCount = Math.max(this.getMaxCellCount(), 1);
    let rowCount = Math.max(this.getMaxRowCount(), 1);  // TODO rename
    console.log('[Hexlab] Cell count: ' + maxCellCount);
    console.log('[Hexlab] Row count: ' + rowCount);
    console.log('[Hexlab] Position: ' + this.currentPosition);

    // Build hex layout/dom structure
    let rowItems = []
    for (let rowIndex = 0; rowIndex < Math.max(rowCount, 1); rowIndex++) {
      // Make a row container that holds the bytes for that row
      let hexRowContainer = document.createElement('div');
      hexRowContainer.classList.add('hexlab_row_container');
      this.hexContent.appendChild(hexRowContainer);
      rowItems.push(hexRowContainer);

      // Make hex cells (holds 1 byte of our bin data)
      let cellCountThisRow = (this.currentPosition + (maxCellCount * (rowIndex + 1))) > this.getLastScrollPosition() ? this.currentFileSize % rowCount : rowCount;
//      let cellCountThisRow = (this.currentPosition + maxCellCount) >= this.currentFileSize ? this.currentFileSize % maxCellCount : maxCellCount;
      console.log('[Hexlab] Calculated cell count: ' + cellCountThisRow);
      for (let j = 0; j < cellCountThisRow; j++) {
        let hexCell: any = document.createElement('div');
        if (j == cellCountThisRow - 1) {
          hexCell.style['background-color'] = 'red';
        }
        hexCell.classList.add('hexlab_hex_byte');
        hexRowContainer.appendChild(hexCell);
      }
    }
    console.log('[Hexlab] Actual rows: ' + rowItems.length);

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
  }
}

/**
* Activate the hexlab widget extension.
*/
function activate(app: JupyterFrontEnd, palette: ICommandPalette, restorer: ILayoutRestorer | null) {
  console.log('[Hexlab] JupyterLab extension hexlab is activated!yy5');

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
