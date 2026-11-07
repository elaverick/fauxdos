; 6502MP guest-thread demonstration. Assembled as a raw executable at $4000.
; Worker ID returned in A is stored in shared zero page, then joined.
.org $4000
START:
    LDA #<WORKER
    STA DESC
    LDA #>WORKER
    STA DESC+1
    LDA #$FD
    STA DESC+2
    LDA #$00
    STA DESC+3
    LDA #$20
    STA DESC+4
    .BYTE $C2, DESC        ; TSPAWND DESC (descriptor in zero page)
    STA WORKER_ID
    LDA #$00
    STA $11
    .BYTE $72, $11        ; lock terminal and shared OS string pointer
    LDA #<STARTED
    STA $00
    LDA #>STARTED
    STA $01
    JSR $F203
    .BYTE $82, $11        ; unlock terminal
    .BYTE $42, WORKER_ID   ; TJOIN WORKER_ID, blocks until child exits
    LDA #<FINISHED
    STA $00
    LDA #>FINISHED
    STA $01
    JSR $F203
    RTS

WORKER:
    LDA #$00
    STA $11
    .BYTE $72, $11        ; lock terminal and shared OS string pointer
    LDA #<WORKING
    STA $00
    LDA #>WORKING
    STA $01
    JSR $F203
    .BYTE $82, $11        ; unlock terminal
    LDX #$00
WORK_LOOP:
    INX
    CPX #$20
    BNE WORK_LOOP
    LDA #$2A
    .BYTE $22             ; TEXIT: worker exit code $2A

STARTED: .BYTE "THREAD CREATED - PARENT WAITING",13,0
WORKING: .BYTE "WORKER RUNNING IN CONTEXT 1",13,0
FINISHED: .BYTE "WORKER EXITED - JOIN COMPLETE",13,0

DESC=$20
WORKER_ID=$25
