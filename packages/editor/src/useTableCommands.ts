/**
 * @file useTableCommands.ts
 * @description Hook for Markdown table manipulation in CodeMirror editor
 * @ref §3.2.3 - Editor Package Development
 */

import { useCallback } from 'react';
import { EditorView } from '@codemirror/view';

export type TableAlignment = 'left' | 'center' | 'right' | 'none';

export interface TableInfo {
  /** Whether the cursor is currently inside a table */
  isInTable: boolean;
  /** Current row index (0 = header, 1 = separator, 2+ = data rows) */
  currentRowIndex: number;
  /** Current column index (0-based) */
  currentColumnIndex: number;
  /** Total number of rows in the table */
  rowCount: number;
  /** Total number of columns in the table */
  columnCount: number;
  /** Alignments for each column */
  alignments: TableAlignment[];
  /** Bounding rect of the table in viewport coordinates */
  tableBounds?: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  /** Y positions of each row top edge in viewport coordinates */
  rowPositions?: number[];
  /** X positions of each column separator in viewport coordinates */
  columnPositions?: number[];
}

export interface TableCommands {
  /** Get information about the table at cursor position */
  getTableInfo: () => TableInfo;
  /** Insert a new row above the current row */
  insertRowAbove: () => void;
  /** Insert a new row below the current row */
  insertRowBelow: () => void;
  /** Insert a new column to the left of the current column */
  insertColumnLeft: () => void;
  /** Insert a new column to the right of the current column */
  insertColumnRight: () => void;
  /** Delete the current row */
  deleteRow: () => void;
  /** Delete the current column */
  deleteColumn: () => void;
  /** Set alignment for the current column */
  setColumnAlignment: (alignment: TableAlignment) => void;
}

const DEFAULT_TABLE_INFO: TableInfo = {
  isInTable: false,
  currentRowIndex: -1,
  currentColumnIndex: -1,
  rowCount: 0,
  columnCount: 0,
  alignments: [],
};

/**
 * Hook that provides Markdown table manipulation commands for CodeMirror.
 *
 * @param editorViewRef - React ref containing the CodeMirror EditorView instance
 * @returns TableCommands object with table manipulation methods
 */
export function useTableCommands(
  editorViewRef: React.RefObject<EditorView | null>
): TableCommands {
  
  const getTableInfo = useCallback((): TableInfo => {
    const view = editorViewRef.current;
    if (!view) return DEFAULT_TABLE_INFO;

    const { from } = view.state.selection.main;
    const doc = view.state.doc;
    const currentLine = doc.lineAt(from);
    const lineText = currentLine.text;

    // Check if current line looks like a table row (starts with |)
    if (!lineText.trim().startsWith('|')) {
      return DEFAULT_TABLE_INFO;
    }

    // Find table boundaries by scanning up and down
    let tableStartLine = currentLine.number;
    let tableEndLine = currentLine.number;

    // Scan upward
    for (let i = currentLine.number - 1; i >= 1; i--) {
      const line = doc.line(i);
      if (line.text.trim().startsWith('|')) {
        tableStartLine = i;
      } else {
        break;
      }
    }

    // Scan downward
    for (let i = currentLine.number + 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      if (line.text.trim().startsWith('|')) {
        tableEndLine = i;
      } else {
        break;
      }
    }

    const rowCount = tableEndLine - tableStartLine + 1;
    const currentRowIndex = currentLine.number - tableStartLine;

    // Parse columns from current line
    const cells = lineText.split('|').filter((c, i, arr) => i > 0 && i < arr.length - 1);
    const columnCount = cells.length;

    // Calculate current column index based on cursor position within line
    let currentColumnIndex = 0;
    let charCount = 0;
    const cursorPosInLine = from - currentLine.from;
    const parts = lineText.split('|');
    for (let i = 1; i < parts.length - 1; i++) {
      charCount += parts[i].length + 1; // +1 for the pipe
      if (cursorPosInLine <= charCount) {
        currentColumnIndex = i - 1;
        break;
      }
      currentColumnIndex = i - 1;
    }

    // Parse alignments from separator row (row index 1)
    const alignments: TableAlignment[] = [];
    if (rowCount >= 2) {
      const separatorLine = doc.line(tableStartLine + 1);
      const sepCells = separatorLine.text.split('|').filter((c, i, arr) => i > 0 && i < arr.length - 1);
      for (const cell of sepCells) {
        const trimmed = cell.trim();
        if (trimmed.startsWith(':') && trimmed.endsWith(':')) {
          alignments.push('center');
        } else if (trimmed.endsWith(':')) {
          alignments.push('right');
        } else if (trimmed.startsWith(':')) {
          alignments.push('left');
        } else {
          alignments.push('none');
        }
      }
    }

    // Calculate viewport positions for UI triggers
    let tableBounds: TableInfo['tableBounds'];
    let rowPositions: number[] = [];
    let columnPositions: number[] = [];

    try {
      const startLineCoords = view.coordsAtPos(doc.line(tableStartLine).from);
      const endLineCoords = view.coordsAtPos(doc.line(tableEndLine).to);
      
      if (startLineCoords && endLineCoords) {
        // Get left/right from the first row
        const firstRowText = doc.line(tableStartLine).text;
        const firstPipePos = doc.line(tableStartLine).from + firstRowText.indexOf('|');
        const lastPipePos = doc.line(tableStartLine).from + firstRowText.lastIndexOf('|');
        const leftCoords = view.coordsAtPos(firstPipePos);
        const rightCoords = view.coordsAtPos(lastPipePos);

        tableBounds = {
          top: startLineCoords.top,
          bottom: endLineCoords.bottom,
          left: leftCoords?.left ?? startLineCoords.left,
          right: rightCoords?.right ?? endLineCoords.right,
        };

        // Calculate row positions
        for (let i = tableStartLine; i <= tableEndLine; i++) {
          const lineCoords = view.coordsAtPos(doc.line(i).from);
          if (lineCoords) {
            rowPositions.push(lineCoords.top);
          }
        }

        // Calculate column positions (pipe character positions in first row)
        const headerLine = doc.line(tableStartLine);
        let pipeIndex = headerLine.text.indexOf('|');
        while (pipeIndex !== -1) {
          const coords = view.coordsAtPos(headerLine.from + pipeIndex);
          if (coords) {
            columnPositions.push(coords.left);
          }
          pipeIndex = headerLine.text.indexOf('|', pipeIndex + 1);
        }
      }
    } catch {
      // Ignore coordinate calculation errors
    }

    return {
      isInTable: true,
      currentRowIndex,
      currentColumnIndex,
      rowCount,
      columnCount,
      alignments,
      tableBounds,
      rowPositions,
      columnPositions,
    };
  }, [editorViewRef]);

  const insertRowAbove = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable || info.currentRowIndex <= 1) return; // Can't insert above header or separator

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    
    // Create new row with same column count
    const newRow = '|' + ' '.repeat(3) + (' |' + ' '.repeat(3)).repeat(info.columnCount - 1) + ' |\n';
    
    view.dispatch({
      changes: { from: currentLine.from, to: currentLine.from, insert: newRow },
    });
  }, [editorViewRef, getTableInfo]);

  const insertRowBelow = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable) return;

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    
    // Create new row with same column count
    const newRow = '\n|' + ' '.repeat(3) + (' |' + ' '.repeat(3)).repeat(info.columnCount - 1) + ' |';
    
    view.dispatch({
      changes: { from: currentLine.to, to: currentLine.to, insert: newRow },
    });
  }, [editorViewRef, getTableInfo]);

  const insertColumnLeft = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable) return;

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    const tableStartLine = currentLine.number - info.currentRowIndex;

    const changes: Array<{ from: number; to: number; insert: string }> = [];

    for (let i = 0; i < info.rowCount; i++) {
      const line = doc.line(tableStartLine + i);
      const parts = line.text.split('|');
      const insertIndex = info.currentColumnIndex + 1;
      
      let cellContent = '   ';
      if (i === 1) {
        cellContent = '---';
      }
      
      parts.splice(insertIndex, 0, cellContent);
      const newText = parts.join('|');
      
      changes.push({ from: line.from, to: line.to, insert: newText });
    }

    view.dispatch({ changes });
  }, [editorViewRef, getTableInfo]);

  const insertColumnRight = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable) return;

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    const tableStartLine = currentLine.number - info.currentRowIndex;

    const changes: Array<{ from: number; to: number; insert: string }> = [];

    for (let i = 0; i < info.rowCount; i++) {
      const line = doc.line(tableStartLine + i);
      const parts = line.text.split('|');
      const insertIndex = info.currentColumnIndex + 2;
      
      let cellContent = '   ';
      if (i === 1) {
        cellContent = '---';
      }
      
      parts.splice(insertIndex, 0, cellContent);
      const newText = parts.join('|');
      
      changes.push({ from: line.from, to: line.to, insert: newText });
    }

    view.dispatch({ changes });
  }, [editorViewRef, getTableInfo]);

  const deleteRow = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable || info.currentRowIndex <= 1 || info.rowCount <= 3) return; // Can't delete header/separator or last data row

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);

    view.dispatch({
      changes: { from: currentLine.from, to: currentLine.to + 1, insert: '' },
    });
  }, [editorViewRef, getTableInfo]);

  const deleteColumn = useCallback(() => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable || info.columnCount <= 1) return;

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    const tableStartLine = currentLine.number - info.currentRowIndex;

    const changes: Array<{ from: number; to: number; insert: string }> = [];

    for (let i = 0; i < info.rowCount; i++) {
      const line = doc.line(tableStartLine + i);
      const parts = line.text.split('|');
      const deleteIndex = info.currentColumnIndex + 1;
      
      if (deleteIndex > 0 && deleteIndex < parts.length - 1) {
        parts.splice(deleteIndex, 1);
        const newText = parts.join('|');
        changes.push({ from: line.from, to: line.to, insert: newText });
      }
    }

    view.dispatch({ changes });
  }, [editorViewRef, getTableInfo]);

  const setColumnAlignment = useCallback((alignment: TableAlignment) => {
    const view = editorViewRef.current;
    if (!view) return;

    const info = getTableInfo();
    if (!info.isInTable || info.rowCount < 2) return;

    const doc = view.state.doc;
    const { from } = view.state.selection.main;
    const currentLine = doc.lineAt(from);
    const tableStartLine = currentLine.number - info.currentRowIndex;
    
    // Modify separator row (row index 1)
    const separatorLine = doc.line(tableStartLine + 1);
    const parts = separatorLine.text.split('|');
    const colIndex = info.currentColumnIndex + 1;

    if (colIndex > 0 && colIndex < parts.length - 1) {
      let newCell: string;
      switch (alignment) {
        case 'left':
          newCell = ':---';
          break;
        case 'center':
          newCell = ':---:';
          break;
        case 'right':
          newCell = '---:';
          break;
        default:
          newCell = '---';
      }
      parts[colIndex] = ` ${newCell} `;
      const newText = parts.join('|');

      view.dispatch({
        changes: { from: separatorLine.from, to: separatorLine.to, insert: newText },
      });
    }
  }, [editorViewRef, getTableInfo]);

  return {
    getTableInfo,
    insertRowAbove,
    insertRowBelow,
    insertColumnLeft,
    insertColumnRight,
    deleteRow,
    deleteColumn,
    setColumnAlignment,
  };
}

export default useTableCommands;
