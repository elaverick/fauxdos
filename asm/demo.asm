; FauxDOS moving-sprite graphics demonstration.
; Any key returns to the text monitor. Sprite bitmap is followed by its
; 1-bit opacity mask; transparent pixels leave the star field untouched.
GFX_COLOUR=$F300
GFX_PLOT=$F303
GFX_BLIT=$F31B
GFX_CLEAR=$F30F
VIDEO_CONTROL=$D001
GFX_MODE=$D028
KEYBOARD_DATA=$D010
XPOS=$30
DIRECTION=$31
YPOS=$32

.org $4000
START:
    LDA #$00
    STA XPOS
    LDA #$01
    STA DIRECTION
    LDA #$2C
    STA YPOS

FRAME:
    ; Clear to a dark blue/black palette cell, then seed a simple star field.
    LDA #$09
    LDX #$00
    JSR GFX_COLOUR
    JSR GFX_CLEAR

    LDX #$08
    LDY #$0B
    JSR GFX_PLOT
    LDX #$1D
    LDY #$12
    JSR GFX_PLOT
    LDX #$34
    LDY #$08
    JSR GFX_PLOT
    LDX #$4A
    LDY #$20
    JSR GFX_PLOT
    LDX #$61
    LDY #$0D
    JSR GFX_PLOT
    LDX #$7B
    LDY #$15
    JSR GFX_PLOT
    LDX #$92
    LDY #$07
    JSR GFX_PLOT
    LDX #$A8
    LDY #$1C
    JSR GFX_PLOT

    ; Yellow/white sprite with blue cut-outs. Drawing calls use the current pen.
    LDA #$0E
    LDX #$00
    JSR GFX_COLOUR
    LDA XPOS
    STA $12
    LDA YPOS
    STA $13
    LDA #<SPRITE_BITMAP
    STA $16
    LDA #>SPRITE_BITMAP
    STA $17
    LDA #$10
    STA $18
    LDA #$0C
    STA $19
    JSR GFX_BLIT

    ; Any key exits; it is consumed here rather than reaching the shell.
    LDA KEYBOARD_DATA
    BEQ NO_KEY
    LDA #$00
    STA GFX_MODE
    LDA #$01
    STA VIDEO_CONTROL
    RTS

NO_KEY:
    LDA DIRECTION
    BEQ MOVE_LEFT
    INC XPOS
    LDA XPOS
    CMP #$90
    BCC FRAME_DELAY
    LDA #$00
    STA DIRECTION
    JMP FRAME_DELAY
MOVE_LEFT:
    LDA XPOS
    BEQ TURN_RIGHT
    DEC XPOS
    JMP FRAME_DELAY
TURN_RIGHT:
    LDA #$01
    STA DIRECTION
    INC XPOS

FRAME_DELAY:
    ; Roughly ten thousand guest cycles between frames.
    LDY #$08
DELAY_OUTER:
    LDX #$00
DELAY_INNER:
    DEX
    BNE DELAY_INNER
    DEY
    BNE DELAY_OUTER
    JMP FRAME

; 16x12 packed 1bpp sprite: bitmap plane followed by opacity mask.
SPRITE_BITMAP:
    .byte $00,$00, $80,$01, $C0,$03, $20,$05
    .byte $10,$09, $18,$19, $3C,$3F, $FE,$7F
    .byte $F8,$1F, $F0,$0F, $E0,$07, $20,$04
SPRITE_MASK:
    .byte $00,$00, $80,$01, $C0,$03, $E0,$07
    .byte $F0,$0F, $F8,$1F, $FC,$3F, $FE,$7F
    .byte $FC,$3F, $F8,$1F, $F0,$0F, $C0,$03
