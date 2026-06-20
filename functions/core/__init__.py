"""MzansiMoney backend - import pipeline, parsers, normalization, categorization.

The dashboard never cares where a transaction came from. Every importer's job is
to turn its source (CSV now; PDF / Gmail later) into the common ``RawTxn`` shape,
which ``model.normalize`` then converts into the single canonical Firestore
transaction document. New data sources are added by writing another parser - the
rest of the system does not change.
"""
