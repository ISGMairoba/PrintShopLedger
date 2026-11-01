# Proposed account-owned payment methods

Status: proposed design; not yet applied to the payment model.

Use one Business Settings section, **Accounts & payment methods**. Creating an account requires its first payment method, with type Cash, Card, Transfer or Other. Additional methods are created inside the account. There is no free-standing method-to-account linking screen.

Each method has one owning account; an account may have many methods. Checkout, debt collection and expense payments choose an account/method combination such as “Moniepoint — Card” or “Moniepoint — Transfer”. They cannot submit a method with another account. Show a single simple account choice when there is only one method.

Account balances combine all methods owned by that account. Reports can group by account or payment channel. Used accounts/methods can be disabled or archived, with names retained in historical records.

Existing transactions retain their original account and payment details. Resolve ambiguous legacy links explicitly rather than guessing or moving old money between accounts. Enforce ownership on the server as well as in the UI, including offline/retry workflows.
