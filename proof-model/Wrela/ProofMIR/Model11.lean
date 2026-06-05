/-!
Model 11 captures validated-buffer layout fact ordering.

The model is intentionally small: fixed fields may be read only after a
`layout.fits` fact for their end offset; dynamic payload bounds may be derived
only after fixed fields are read; payload bytes may be read only after a
`layout.fits` fact for the derived payload end.
-/

namespace Wrela.ProofMIR.Model11

inductive LayoutFact where
  | fits (endOffset : Nat)
  | fixedEnd (endOffset : Nat)
  | payloadEnd (endOffset : Nat)
deriving Repr, BEq, DecidableEq

structure LayoutState where
  sourceLength : Nat
  facts : List LayoutFact
  fixedFieldsRead : Bool
  payloadRead : Bool
deriving Repr, DecidableEq

def factLive (state : LayoutState) (fact : LayoutFact) : Bool :=
  state.facts.any (fun existing => existing == fact)

inductive Cmd where
  | ensureFits (endOffset : Nat)
  | readFixedFields (endOffset : Nat)
  | derivePayloadEnd (fixedEnd payloadEnd : Nat)
  | readPayload (payloadEnd : Nat)
  | seq (first second : Cmd)
deriving Repr

def check (source : LayoutState) : Cmd -> Option LayoutState
  | .ensureFits endOffset =>
      if endOffset <= source.sourceLength then
        some { source with facts := .fits endOffset :: source.facts }
      else
        none

  | .readFixedFields endOffset =>
      if factLive source (.fits endOffset) then
        some
          {
            source with
            facts := .fixedEnd endOffset :: source.facts,
            fixedFieldsRead := true,
          }
      else
        none

  | .derivePayloadEnd fixedEnd payloadEnd =>
      if source.fixedFieldsRead then
        if factLive source (.fixedEnd fixedEnd) then
          some { source with facts := .payloadEnd payloadEnd :: source.facts }
        else
          none
      else
        none

  | .readPayload payloadEnd =>
      if factLive source (.payloadEnd payloadEnd) then
        if factLive source (.fits payloadEnd) then
          some { source with payloadRead := true }
        else
          none
      else
        none

  | .seq first second =>
      match check source first with
      | none => none
      | some middle => check middle second

inductive LayoutChecked : LayoutState -> Cmd -> LayoutState -> Prop where
  | ensureFits :
      endOffset <= source.sourceLength ->
      LayoutChecked source
        (.ensureFits endOffset)
        { source with facts := .fits endOffset :: source.facts }

  | readFixedFields :
      factLive source (.fits endOffset) = true ->
      LayoutChecked source
        (.readFixedFields endOffset)
        {
          source with
          facts := .fixedEnd endOffset :: source.facts,
          fixedFieldsRead := true,
        }

  | derivePayloadEnd :
      source.fixedFieldsRead = true ->
      factLive source (.fixedEnd fixedEnd) = true ->
      LayoutChecked source
        (.derivePayloadEnd fixedEnd payloadEnd)
        { source with facts := .payloadEnd payloadEnd :: source.facts }

  | readPayload :
      factLive source (.payloadEnd payloadEnd) = true ->
      factLive source (.fits payloadEnd) = true ->
      LayoutChecked source
        (.readPayload payloadEnd)
        { source with payloadRead := true }

  | seq :
      LayoutChecked source first middle ->
      LayoutChecked middle second result ->
      LayoutChecked source (.seq first second) result

theorem check_sound
    {source result : LayoutState}
    {command : Cmd}
    (accepted : check source command = some result) :
    LayoutChecked source command result := by
  induction command generalizing source result with
  | ensureFits endOffset =>
      unfold check at accepted
      split at accepted
      · rename_i fits
        cases accepted
        exact LayoutChecked.ensureFits fits
      · contradiction

  | readFixedFields endOffset =>
      unfold check at accepted
      split at accepted
      · rename_i fits
        cases accepted
        exact LayoutChecked.readFixedFields fits
      · contradiction

  | derivePayloadEnd fixedEnd payloadEnd =>
      unfold check at accepted
      split at accepted
      · rename_i fieldsRead
        split at accepted
        · rename_i fixedEndKnown
          cases accepted
          exact LayoutChecked.derivePayloadEnd fieldsRead fixedEndKnown
        · contradiction
      · contradiction

  | readPayload payloadEnd =>
      unfold check at accepted
      split at accepted
      · rename_i payloadEndKnown
        split at accepted
        · rename_i fits
          cases accepted
          exact LayoutChecked.readPayload payloadEndKnown fits
        · contradiction
      · contradiction

  | seq first second firstSound secondSound =>
      unfold check at accepted
      cases firstResult : check source first with
      | none =>
          simp [firstResult] at accepted
      | some middle =>
          simp [firstResult] at accepted
          exact LayoutChecked.seq (firstSound firstResult) (secondSound accepted)

theorem checked_readPayload_requires_facts
    {source result : LayoutState}
    {payloadEnd : Nat}
    (checked : LayoutChecked source (.readPayload payloadEnd) result) :
    factLive source (.payloadEnd payloadEnd) = true ∧
      factLive source (.fits payloadEnd) = true := by
  cases checked with
  | readPayload payloadEndKnown fits =>
      exact And.intro payloadEndKnown fits

theorem check_readPayload_requires_facts
    {source result : LayoutState}
    {payloadEnd : Nat}
    (accepted : check source (.readPayload payloadEnd) = some result) :
    factLive source (.payloadEnd payloadEnd) = true ∧
      factLive source (.fits payloadEnd) = true :=
  checked_readPayload_requires_facts (check_sound accepted)

theorem checked_readFixedFields_requires_fits
    {source result : LayoutState}
    {endOffset : Nat}
    (checked : LayoutChecked source (.readFixedFields endOffset) result) :
    factLive source (.fits endOffset) = true := by
  cases checked with
  | readFixedFields fits =>
      exact fits

theorem checked_derivePayloadEnd_requires_fixed_fields
    {source result : LayoutState}
    {fixedEnd payloadEnd : Nat}
    (checked : LayoutChecked source (.derivePayloadEnd fixedEnd payloadEnd) result) :
    source.fixedFieldsRead = true ∧ factLive source (.fixedEnd fixedEnd) = true := by
  cases checked with
  | derivePayloadEnd fieldsRead fixedEndKnown =>
      exact And.intro fieldsRead fixedEndKnown

def packetSource : LayoutState :=
  {
    sourceLength := 64,
    facts := [],
    fixedFieldsRead := false,
    payloadRead := false,
  }

def validPacketLayout : Cmd :=
  .seq
    (.ensureFits 14)
    (.seq
      (.readFixedFields 14)
      (.seq
        (.derivePayloadEnd 14 60)
        (.seq (.ensureFits 60) (.readPayload 60))))

example :
    check packetSource validPacketLayout =
      some
        {
          packetSource with
          facts := [.fits 60, .payloadEnd 60, .fixedEnd 14, .fits 14],
          fixedFieldsRead := true,
          payloadRead := true,
        } := by
  rfl

def dynamicReadBeforeFits : Cmd :=
  .seq
    (.ensureFits 14)
    (.seq
      (.readFixedFields 14)
      (.seq
        (.derivePayloadEnd 14 60)
        (.readPayload 60)))

example : check packetSource dynamicReadBeforeFits = none := by
  rfl

def dynamicReadBeforeFixedFields : Cmd :=
  .seq
    (.ensureFits 60)
    (.seq (.derivePayloadEnd 14 60) (.readPayload 60))

example : check packetSource dynamicReadBeforeFixedFields = none := by
  rfl

def fixedReadBeforeFits : Cmd :=
  .readFixedFields 14

example : check packetSource fixedReadBeforeFits = none := by
  rfl

def fitsCannotExceedSourceLength : Cmd :=
  .ensureFits 80

example : check packetSource fitsCannotExceedSourceLength = none := by
  rfl

end Wrela.ProofMIR.Model11
