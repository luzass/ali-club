require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Configurações da API do Asaas
const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://sandbox.asaas.com/api/v3';
const ASAAS_API_KEY = process.env.ASAAS_API_KEY; 

if (!ASAAS_API_KEY) {
    console.error("⚠️ ERRO: Chave da API do Asaas não configurada no arquivo .env");
    process.exit(1);
}

// ============================================================================
// ROTA PRINCIPAL: Criar Assinatura (Cliente + Assinatura + PIX)
// ============================================================================
app.post('/api/criar-assinatura', async (req, res) => {
    try {
        const { name, email, cpfCnpj, phone, billingType, value, creditCard, address } = req.body;

        if (!name || !email || !cpfCnpj || !billingType) {
            return res.status(400).json({ error: 'Dados obrigatórios faltando.' });
        }

        console.log(`\n⏳ Iniciando processo para: ${name} (${billingType})`);

        // ====================================================================
        // PASSO 1: CRIAR O CLIENTE NO ASAAS
        // ====================================================================
        const customerResponse = await fetch(`${ASAAS_API_URL}/customers`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': ASAAS_API_KEY
            },
            body: JSON.stringify({
                name: name,
                email: email,
                cpfCnpj: cpfCnpj,
                phone: phone
            })
        });

        const customerData = await customerResponse.json();

        if (!customerResponse.ok) {
            console.error("❌ Erro ao criar cliente no Asaas. Detalhes:");
            console.error(JSON.stringify(customerData.errors, null, 2));
            return res.status(400).json({ 
                error: 'Erro ao criar cliente no Asaas', 
                details: customerData.errors 
            });
        }

        const customerId = customerData.id;
        console.log(`✅ Cliente criado com sucesso. ID: ${customerId}`);

        // ====================================================================
        // PASSO 2: CRIAR A ASSINATURA
        // ====================================================================
        const subscriptionPayload = {
            customer: customerId,
            billingType: billingType, 
            value: value || 15.90,
            nextDueDate: new Date().toISOString().split('T')[0], // Cobrar hoje
            cycle: 'MONTHLY',
            description: 'Assinatura Mensal - Ali+ Club'
        };

        if (billingType === 'CREDIT_CARD') {
            subscriptionPayload.creditCard = {
                holderName: creditCard.holderName,
                number: creditCard.number,
                expiryMonth: creditCard.expiryMonth,
                expiryYear: creditCard.expiryYear,
                ccv: creditCard.ccv
            };
            
            subscriptionPayload.creditCardHolderInfo = {
                name: name,
                email: email,
                cpfCnpj: cpfCnpj,
                phone: phone,
                postalCode: address.postalCode, 
                addressNumber: address.addressNumber
            };
        }

        const subscriptionResponse = await fetch(`${ASAAS_API_URL}/subscriptions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'access_token': ASAAS_API_KEY
            },
            body: JSON.stringify(subscriptionPayload)
        });

        const subscriptionData = await subscriptionResponse.json();

        if (!subscriptionResponse.ok) {
            console.error("❌ Erro ao criar assinatura no Asaas. Detalhes:");
            console.error(JSON.stringify(subscriptionData.errors, null, 2));
            return res.status(400).json({ 
                error: 'Erro ao criar assinatura no Asaas', 
                details: subscriptionData.errors 
            });
        }

        const subscriptionId = subscriptionData.id;
        console.log(`✅ Assinatura criada com sucesso. ID: ${subscriptionId}`);

        // ====================================================================
        // PASSO 3: SE FOR PIX, BUSCAR O QR CODE DA PRIMEIRA COBRANÇA
        // ====================================================================
        let pixQrCode = null;
        let pixCopyPaste = null;

        if (billingType === 'PIX') {
            console.log(`🔄 Buscando QR Code do PIX gerado pela assinatura...`);
            
            // Aguarda 1.5 segundos para garantir que o Asaas gerou a cobrança da assinatura
            await new Promise(resolve => setTimeout(resolve, 1500));

            // 3.1 Buscar as cobranças dessa assinatura
            const paymentsResponse = await fetch(`${ASAAS_API_URL}/subscriptions/${subscriptionId}/payments`, {
                method: 'GET',
                headers: { 'access_token': ASAAS_API_KEY }
            });
            const paymentsData = await paymentsResponse.json();

            if (paymentsData.data && paymentsData.data.length > 0) {
                const firstPaymentId = paymentsData.data[0].id;
                console.log(`✅ Cobrança encontrada. ID: ${firstPaymentId}`);

                // 3.2 Buscar o QR Code dessa cobrança
                const qrResponse = await fetch(`${ASAAS_API_URL}/payments/${firstPaymentId}/pixQrCode`, {
                    method: 'GET',
                    headers: { 'access_token': ASAAS_API_KEY }
                });
                const qrData = await qrResponse.json();

                if (qrResponse.ok) {
                    pixQrCode = qrData.encodedImage; // Imagem em Base64
                    pixCopyPaste = qrData.payload;   // Código Copia e Cola
                    console.log(`✅ QR Code do PIX capturado com sucesso!`);
                } else {
                    console.error("❌ Erro ao buscar QR Code:", qrData);
                }
            } else {
                console.error("❌ Nenhuma cobrança encontrada para esta assinatura ainda.");
            }
        }

        // ====================================================================
        // PASSO 4: RETORNAR SUCESSO PARA O FRONTEND
        // ====================================================================
        res.status(200).json({
            success: true,
            message: 'Assinatura criada com sucesso!',
            subscriptionId: subscriptionId,
            customerId: customerId,
            paymentMethod: billingType,
            // Estes campos só terão valor se for PIX
            pixQrCode: pixQrCode,
            pixCopyPaste: pixCopyPaste
        });

    } catch (error) {
        console.error("🔥 Erro interno no servidor:", error);
        res.status(500).json({ error: 'Erro interno no servidor ao processar a requisição.' });
    }
});

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`🔗 Endpoint de assinaturas: http://localhost:${PORT}/api/criar-assinatura`);
});