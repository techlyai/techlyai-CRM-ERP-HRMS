-- Migration 014: one polite wording for every client. Messages carry only the client's name
-- ({{1}}) and website ({{2}}); amounts are left out of the text and shown on the Pay now page.
-- Payment messages have a "Pay now" URL button (/pay/{{1}}); the thank-you has a receipt button.
begin;

update public.mmc_settings set data=jsonb_set(data,'{templates}',(
 select jsonb_object_agg(k, v||jsonb_build_object('whatsapp_vars',jsonb_build_array('client_name','website'))||case k
  when 'reminder' then jsonb_build_object('whatsapp_button','pay_token','text',
   'Hello {{client_name}}, this is a gentle reminder that the monthly maintenance charge (MMC) for your website {{website}} is due. Kindly make the payment at your earliest convenience to keep your website running smoothly. Tap Pay now to pay securely by UPI. Thank you!')
  when 'due_today' then jsonb_build_object('whatsapp_button','pay_token','text',
   'Hello {{client_name}}, the monthly maintenance charge (MMC) for your website {{website}} is due today. Kindly make the payment today to keep your website running smoothly. Tap Pay now to pay securely by UPI. Thank you!')
  when 'overdue' then jsonb_build_object('whatsapp_button','pay_token','text',
   'Hello {{client_name}}, the monthly maintenance charge (MMC) for your website {{website}} is still pending. Kindly make the payment at the earliest to avoid any interruption to your website. Tap Pay now to pay securely by UPI. Thank you!')
  when 'suspended' then jsonb_build_object('whatsapp_button','pay_token','text',
   'Hello {{client_name}}, your website {{website}} has been temporarily suspended as the monthly maintenance charge (MMC) is pending. Kindly make the payment to restore your website. Tap Pay now to pay securely by UPI.')
  when 'reactivated' then jsonb_build_object('whatsapp_button','','text',
   'Hello {{client_name}}, thank you for your payment! Your website {{website}} is active again and running smoothly.')
  when 'payment_received' then jsonb_build_object('whatsapp_button','receipt_token','text',
   'Hello {{client_name}}, thank you for your payment! We have received the monthly maintenance charge (MMC) for your website {{website}}. Your website will continue to run smoothly. Receipt: {{receipt_link}}')
  else '{}'::jsonb end)
 from jsonb_each(data->'templates') t(k,v))) where id=1;
commit;
