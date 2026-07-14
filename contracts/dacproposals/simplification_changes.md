## Actiions that have been changed

`prop.worlds` has been added to perform actions on `escrw.worlds`

- `approve` permission added to escrow controlled by `prop.worlds`

### Actions added to the approve permission:

- `approve`
- `dispute`
- `disapprove`
- `refund`

### Action calling changes

- simplified permission structure

  - needs only active permission of the custodian to `voteprop` and `votepropfin`

- `arbdeny` now calls escorw inline to `disapprove`
- `arbapprove` now calls escrow inline to `approve`
- `cancelwip` now calls escrow inline to `refund`
- `dispute` now calls escrow inline to `dispute`
