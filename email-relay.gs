/** Puente gratuito de correo para Capitán POS, ejecutado con tu propia cuenta Google. */
function doPost(e) {
  try {
    const data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const expected = PropertiesService.getScriptProperties().getProperty('POS_EMAIL_SECRET');
    if (!expected || data.secret !== expected) return output({ success: false, message: 'No autorizado.' });
    if (data.to !== 'yohedespertado@gmail.com' || typeof data.subject !== 'string' || typeof data.text !== 'string') {
      return output({ success: false, message: 'Datos de correo inválidos.' });
    }
    MailApp.sendEmail({
      to: 'yohedespertado@gmail.com',
      subject: data.subject.slice(0, 180),
      body: data.text.slice(0, 12000),
      name: 'Capitán POS'
    });
    return output({ success: true });
  } catch (error) {
    return output({ success: false, message: 'Google no pudo enviar el correo. Revisa la autorización y la cuota diaria.' });
  }
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function authorizeEmail() { MailApp.getRemainingDailyQuota(); }
