---------------------------- MODULE CompleteIgnoresAmendment ----------------------------
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Obligations, MaxVersions, LastDate, None

VARIABLE register

Dates == 1..LastDate

ContractStart == 1

ContractText == <<"a", "b", "a", "c">>

AmendmentText == <<"c", "a", "c">>

Quotes == {<<"a">>, <<"b">>, <<"a", "c">>, <<"c", "b">>}

TextOf(source) == IF source = "contract" THEN ContractText ELSE AmendmentText

Starts(quote, text) ==
  {s \in 0..(Len(text) - Len(quote)) : SubSeq(text, s + 1, s + Len(quote)) = quote}

IsUniqueSpan(quote, text) == Cardinality(Starts(quote, text)) = 1

SpanOf(quote, text) ==
  IF Starts(quote, text) = {}
    THEN None
    ELSE LET first == CHOOSE s \in Starts(quote, text) : \A u \in Starts(quote, text) : s <= u
         IN [start |-> first, end |-> first + Len(quote)]

Latest(o) == register[o][Len(register[o])]

Proposal(quote) ==
  [state |-> "proposed", source |-> "contract", quote |-> quote, span |-> None,
   from |-> ContractStart, to |-> None, nextDue |-> None]

Successor(quote, date) ==
  [state |-> "verified", source |-> "amendment", quote |-> quote, span |-> SpanOf(quote, AmendmentText),
   from |-> date, to |-> None, nextDue |-> None]

Ended(r, date) ==
  IF r.nextDue < date
    THEN [r EXCEPT !.to = date]
    ELSE [r EXCEPT !.to = date, !.state = "superseded", !.nextDue = None]

Init == register = [o \in Obligations |-> << >>]

Propose(o, quote) ==
  /\ register[o] = << >>
  /\ register' = [register EXCEPT ![o] = <<Proposal(quote)>>]

AcceptQuote(o, v) ==
  /\ v \in DOMAIN register[o]
  /\ LET r == register[o][v] IN
     /\ r.state = "proposed"
     /\ IsUniqueSpan(r.quote, TextOf(r.source))
     /\ register' = [register EXCEPT ![o][v] =
          [r EXCEPT !.state = "verified", !.span = SpanOf(r.quote, TextOf(r.source))]]

RejectQuote(o, v) ==
  /\ v \in DOMAIN register[o]
  /\ LET r == register[o][v] IN
     /\ r.state = "proposed"
     /\ ~IsUniqueSpan(r.quote, TextOf(r.source))
     /\ register' = [register EXCEPT ![o][v] = [r EXCEPT !.state = "rejected"]]

Activate(o, v, due) ==
  /\ v \in DOMAIN register[o]
  /\ LET r == register[o][v] IN
     /\ r.state = "verified"
     /\ due >= r.from
     /\ register' = [register EXCEPT ![o][v] = [r EXCEPT !.state = "active", !.nextDue = due]]

CompleteLast(o, v) ==
  /\ v \in DOMAIN register[o]
  /\ LET r == register[o][v] IN
     /\ r.state = "active"
     /\ register' = [register EXCEPT ![o][v] = [r EXCEPT !.state = "done", !.nextDue = None]]

CompleteAndAdvance(o, v, due) ==
  /\ v \in DOMAIN register[o]
  /\ LET r == register[o][v] IN
     /\ r.state = "active"
     /\ due > r.nextDue
     /\ register' = [register EXCEPT ![o][v] =
          [r EXCEPT !.nextDue = due]]

CanAmend(o, date) ==
  /\ register[o] # << >>
  /\ Latest(o).state = "active"
  /\ Latest(o).to = None
  /\ date > Latest(o).from

AmendReplace(o, date, quote) ==
  /\ CanAmend(o, date)
  /\ Len(register[o]) < MaxVersions
  /\ IsUniqueSpan(quote, AmendmentText)
  /\ register' = [register EXCEPT ![o] =
       Append([@ EXCEPT ![Len(@)] = Ended(@, date)], Successor(quote, date))]

AmendRemove(o, date) ==
  /\ CanAmend(o, date)
  /\ register' = [register EXCEPT ![o][Len(register[o])] = Ended(@, date)]

NothingLeftToDo ==
  /\ \A o \in Obligations :
       /\ register[o] # << >>
       /\ \A v \in DOMAIN register[o] : register[o][v].state \in {"rejected", "done", "superseded"}
  /\ UNCHANGED register

Versions == 1..MaxVersions

Next ==
  \/ \E o \in Obligations, quote \in Quotes : Propose(o, quote)
  \/ \E o \in Obligations, v \in Versions : AcceptQuote(o, v)
  \/ \E o \in Obligations, v \in Versions : RejectQuote(o, v)
  \/ \E o \in Obligations, v \in Versions, due \in Dates : Activate(o, v, due)
  \/ \E o \in Obligations, v \in Versions : CompleteLast(o, v)
  \/ \E o \in Obligations, v \in Versions, due \in Dates : CompleteAndAdvance(o, v, due)
  \/ \E o \in Obligations, date \in Dates, quote \in Quotes : AmendReplace(o, date, quote)
  \/ \E o \in Obligations, date \in Dates : AmendRemove(o, date)
  \/ NothingLeftToDo

Spec == Init /\ [][Next]_register

Accepted(r) == r.state \in {"verified", "active", "done", "superseded"}

InForce(r, date) == Accepted(r) /\ r.from <= date /\ (r.to = None \/ date < r.to)

QuoteChecked(r) ==
  /\ r.span # None
  /\ SubSeq(TextOf(r.source), r.span.start + 1, r.span.end) = r.quote
  /\ IsUniqueSpan(r.quote, TextOf(r.source))

Slots == {s \in [obligation : Obligations, version : Versions] : s.version <= Len(register[s.obligation])}

Row(slot) == register[slot.obligation][slot.version]

DueItems == {[slot |-> s, date |-> Row(s).nextDue] : s \in {x \in Slots : Row(x).state = "active"}}

Covered(o, date) ==
  /\ register[o] # << >>
  /\ Accepted(register[o][1])
  /\ register[o][1].from <= date
  /\ (Latest(o).to = None \/ date < Latest(o).to)

RowOK(r) ==
  /\ r.state \in {"proposed", "rejected", "verified", "active", "done", "superseded"}
  /\ r.source \in {"contract", "amendment"}
  /\ r.quote \in Quotes
  /\ r.from \in Dates
  /\ r.to \in Dates \cup {None}
  /\ r.nextDue \in Dates \cup {None}
  /\ (r.state = "active") = (r.nextDue # None)
  /\ (r.state = "superseded") => (r.to # None)
  /\ (r.to # None) => (r.from < r.to)

TypeOK ==
  \A o \in Obligations :
    /\ Len(register[o]) <= MaxVersions
    /\ \A v \in DOMAIN register[o] : RowOK(register[o][v])

OnlyVerifiedCreateTasks == \A item \in DueItems : QuoteChecked(Row(item.slot))

OneVersionInForce ==
  \A o \in Obligations, date \in Dates :
    Cardinality({v \in DOMAIN register[o] : InForce(register[o][v], date)})
      = (IF Covered(o, date) THEN 1 ELSE 0)

SupersededNeverDue == \A item \in DueItems : InForce(Row(item.slot), item.date)

===============================================================================
