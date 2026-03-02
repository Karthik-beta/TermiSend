/**
 * Box
 *
 * Purpose: Styled box wrapper with consistent spacing and border options
 * Props: Inherits all Ink Box props plus theme-aware defaults
 * State: None - Presentational component
 * Extension: Add animation support, custom border styles, or theme variants
 */

/** @jsxImportSource react */
import { Box as InkBox } from 'ink';
import type React from 'react';
import { borders, colors } from '../../theme.js';

interface BoxProps {
  children: React.ReactNode;
  flexDirection?: 'row' | 'column';
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | string;
  width?: number | string;
  height?: number | string;
  minWidth?: number;
  minHeight?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  margin?: number;
  marginTop?: number;
  marginBottom?: number;
  marginLeft?: number;
  marginRight?: number;
  borderStyle?: keyof typeof borders;
  borderColor?: string;
  gap?: number;
  alignItems?: 'flex-start' | 'center' | 'flex-end' | 'stretch';
  justifyContent?: 'flex-start' | 'center' | 'flex-end' | 'space-between';
}

export function Box({
  children,
  flexDirection = 'row',
  flexGrow,
  flexShrink,
  flexBasis,
  width,
  height,
  minWidth,
  minHeight,
  padding,
  paddingX,
  paddingY,
  margin,
  marginTop,
  marginBottom,
  marginLeft,
  marginRight,
  borderStyle,
  borderColor = colors.primary,
  gap,
  alignItems,
  justifyContent,
}: BoxProps): React.ReactElement {
  return (
    <InkBox
      flexDirection={flexDirection}
      flexGrow={flexGrow}
      flexShrink={flexShrink}
      flexBasis={flexBasis}
      width={width}
      height={height}
      minWidth={minWidth}
      minHeight={minHeight}
      padding={padding}
      paddingX={paddingX}
      paddingY={paddingY}
      margin={margin}
      marginTop={marginTop}
      marginBottom={marginBottom}
      marginLeft={marginLeft}
      marginRight={marginRight}
      borderStyle={borderStyle ? borders[borderStyle] : undefined}
      borderColor={borderColor}
      gap={gap}
      alignItems={alignItems}
      justifyContent={justifyContent}
    >
      {children}
    </InkBox>
  );
}
