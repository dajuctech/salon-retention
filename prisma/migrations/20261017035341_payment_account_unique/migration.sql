-- One connected account per salon: a payment can never be matched to the wrong salon.
CREATE UNIQUE INDEX "salon_paymentProviderAccount_key" ON "salon"("paymentProviderAccount");
