export const getMockPaymentMethods = () => [
    {
        method: "upi",

        title: "UPI",

        fields: ["upiId"],
    },

    {
        method: "card",

        title: "Card",

        fields: [
            "cardHolderName",
            "cardNumber",
            "expiryMonth",
            "expiryYear",
            "cvv",
        ],
    },

    {
        method: "cash",

        title: "Cash on Delivery",

        fields: [],
    },
];

export const buildMockTransactionId = (method) =>
    `MOCK_${method.toUpperCase()}_${Date.now()}_${Math.floor(
        Math.random() * 1000000
    )}`;
