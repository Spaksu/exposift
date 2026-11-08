<?php // Yönetici rehberi – Türkçe içerik (admin-guide.php tarafından eklenir)
g_open(
    'Yönetici rehberi',
    '<b>Ayarlar</b> (çark simgesi) altındaki her şey, Exposift\'in bir belgenin metninde <b>neyi aradığını</b> ve bulduğunu <b>nasıl tarttığını</b> belirler. Bu rehber her ekranı ve parçaların birbirine nasıl bağlandığını anlatır.',
    [
        'how'        => 'Parçalar nasıl birleşir',
        'rules'      => 'Kurallar',
        'dictionary' => 'Özel sözlük',
        'categories' => 'Kategoriler ve etiketler',
        'scan'       => 'Tarama eşleştirme',
        'lists'      => 'Listeler ve istisnalar',
        'general'    => 'Genel ayarlar',
        'ai'         => 'Yapay zekâ bağlantıları',
        'backup'     => 'Yedekle / geri yükle',
        'security'   => 'Parola ve güvenlik',
        'tips'       => 'İyi uygulamalar',
    ],
    'Yönetici rehberi'
);
?>

<?php g_section('how', 'Parçalar nasıl birleşir'); ?>
<p>Exposift bir belgenin metnini okurken iki katmanla çalışır:</p>
<ol>
  <li><b>Yerleşik denetimler</b> (e-posta, telefon, sağlama toplamlı kimlik numaraları, IBAN, kartlar, IP adresleri, sırlar). Önce çalışırlar; bir kuralla aynı metni bulurlarsa onlar kazanır.</li>
  <li><b>Maskeleme kuralları.</b> Her kural tek tür bir değeri tanır ve bir <b>kategoriye</b> bağlıdır. <b>Tarama eşleştirme</b> sonra bir kategoriyi (ya da tek bir kuralı) bir <b>tarama türüne</b> çevirir; tarama türü de bulguda gördüğünüz risk sınıfını ve önem derecesini belirler.</li>
</ol>
<?php g_example(
    "Kural: \"İç sunucu adı\"\nKategori: Hostname\nTarama türü: Sunucu veya alan adı",
    "Bulgu: Sunucu veya alan adı\nSınıf: Bağlamsal Fazla Paylaşım\nÖnem: Orta",
    'Düzenlediğiniz', 'Taramada gördüğünüz'
); ?>
<?php g_note('Bu ekranlardaki her şey <b>yalnızca bu tarayıcıda</b> saklanır. Hiçbir şey bir sunucuya gönderilmez; site verilerini silerseniz her şey varsayılanlara döner.', 'info'); ?>

<?php g_section('rules', 'Kurallar'); ?>
<p>Her kural <b>tek tür veriyi</b> nasıl tanıyacağını tanımlar. Yerleşik kuralları düzenleyebilir, kapatabilir ya da sıfırlayabilir, kendi kurallarınızı ekleyebilirsiniz.</p>
<ul>
  <li><b>Arama ve süzgeçler</b>: ada, açıklamaya, desene ya da anahtara göre; kategori, tür ve duruma göre (açık, kapalı, özel, yerleşik, bozuk).</li>
  <li><b>Öncelik</b>: iki kural aynı metni bulursa önceliği yüksek olan kazanır.</li>
  <li><b>Kip</b>: bazı kurallar yalnızca günlüklerde ya da yalnızca betiklerde çalışır; "otomatik" satır yapısına bakarak tahmin eder.</li>
  <li><b>Tarama türü</b> (kural düzenleyicide): bu kuralın eşleşmesi belge taramasında neye dönüşür. "Kategoriyi izle" kategorinin ayarını kullanır.</li>
  <li><b>Canlı deneme</b>: düzenleyicide bir örnek yazın, kaydetmeden önce kuralın neyi yakaladığını görün.</li>
  <li><b>Toplu işlemler</b>: birkaç kuralı işaretleyip birlikte açın ya da kapatın.</li>
</ul>
<?php g_note('Değiştirdiğiniz yerleşik bir kuralı kural düzenleyicisinden özgün haline <b>sıfırlayabilirsiniz</b>. <i>Bozuk</i> işaretli kuralın deseni çalışamıyordur; düzeltin ya da kapatın.', 'tip'); ?>

<?php g_section('dictionary', 'Özel sözlük'); ?>
<p>Bazı şeyler bir desenle tanınamaz: sunucu adlarınız, proje kod adları, müşteri adları. Bunları buraya, her satıra bir tane yazın. Her belgede <b>tam sözcük</b> olarak ve <b>büyük/küçük harfe bakmadan</b> eşleşirler.</p>
<?php g_note('Yalnızca tek bir dosya için önemli adlarda başlangıç ekranındaki <b>Aranacak ad veya sözcükler</b> kutusunu kullanın. O yalnızca o tarama için tutulur.', 'tip'); ?>

<?php g_section('categories', 'Kategoriler ve etiketler'); ?>
<p>Kategoriler kuralları gruplar (Parola, Anahtar / Token, Hostname, Kişi, E-posta, Telefon vb.). Her kategori için şunları ayarlayabilirsiniz:</p>
<ul>
  <li><b>Etiket öneki</b> ve <b>renk</b>: Yapay zekâya sor için metin maskelenirken kullanılır.</li>
  <li><b>Yayılım</b>: bağlamla bulunan bir değer (örneğin <code>user=ahmet</code>) metnin başka yerlerinde bağlamsız göründüğünde de maskelenir.</li>
  <li><b>Yer tutucu şablonu</b>: maskelenmiş değerin biçimi. Değişkenler: <code>{CAT}</code> önek, <code>{cat}</code> küçük harfli önek, <code>{n}</code> sıra numarası, <code>{hash}</code>, <code>{len}</code>, <code>{stars}</code>.</li>
</ul>
<?php g_example('ahmet.kaya@example.com  →  ahmet.kaya@example.com', '<EMAIL_1>  ←  ahmet.kaya@example.com', 'Özgün', 'Şablon <{CAT}_{n}>'); ?>
<?php g_note('<code>{n}</code> ya da <code>{hash}</code> içermeyen şablon sonradan geri yüklenemez; yapay zekâ yanıtındaki etiketlere gerçek değerler geri konamaz.', 'warn'); ?>

<?php g_section('scan', 'Tarama eşleştirme'); ?>
<p>Bu tablo, <b>belge taranırken her eşleşmenin neye dönüşeceğini</b> belirler.</p>
<ul>
  <li><b>Belge taramasında kullan</b>: bulgu üretmesini istemediğiniz kategoriyi tümüyle kapatın.</li>
  <li><b>Tarama türü</b>: kategorinin dönüştüğü tür. Sağdaki sütun ortaya çıkan sınıfı ve önem derecesini gösterir.</li>
  <li><b>Kendi tarama türü olan kurallar</b>: tek bir kural kategorisini geçersiz kılabilir. Yeniden kategoriyi izlemesi için geçersiz kılmayı kaldırın.</li>
  <li><b>Alan etiketleri</b>: belgeler çoğu zaman değerin yanına bir etiket koyar ("Ad Soyad", "Posta adresi", "API token"). Her tarama türü için bir satır: tür, iki nokta, sonra virgülle ayrılmış etiketler. Etiketten sonraki değer ya da yandaki tablo hücresi o tarama türü olur.</li>
  <li><b>Deneyin</b>: birkaç satır yapıştırın; neyin bulunacağını ve nasıl sınıflanacağını görün.</li>
</ul>
<?php g_shot('scan', 'Tarama eşleştirme: her kategori, sınıfı ve önem derecesiyle bir tarama türüne dönüşür.'); ?>
<?php g_note('Yerleşik denetimler kurallara üstündür. Bir değeri ikisi de bulursa türünü yerleşik denetim belirler.', 'info'); ?>

<?php g_section('lists', 'Listeler ve istisnalar'); ?>
<p>Motorun değerleri nasıl tanıdığını ve nasıl dışarıda bıraktığını belirleyen listeler. Kaydedildikleri anda <b>tüm kurallara</b> uygulanır. Her satıra bir kayıt; yerleşik varsayılanlar için listeyi boş bırakın. Düzenlemelerinizi geri almak için tek tek listelerde <b>varsayılana sıfırla</b> kullanın.</p>
<?php g_note('Zararsız bir şey sürekli işaretleniyorsa değeri bir dışlama listesine ekleyin; örneğin antetli kâğıdınızda yer alan herkese açık bir adres.', 'tip'); ?>

<?php g_section('general', 'Genel ayarlar'); ?>
<?php g_table([
    ['Ayar', 'Ne yapar'],
    ['<b>Genel yer tutucu şablonu</b>', 'Kendi şablonu olmayan kategoriler için varsayılan etiket biçimi.'],
    ['<b>Yayılım</b> ve <b>en düşük uzunluk</b>', 'Bağlamla bulunan değerlerin her yerde maskelenip maskelenmeyeceği ve yayılabilecek en kısa değer. "it" ya da "db" gibi kısa değerlerin her yerde maskelenmesini önler.'],
    ['<b>Varsayılan kip</b>', 'Otomatik, Günlük ya da Betik. Bazı kurallar yalnızca bir kipte çalışır. Yapay zekâya sor ve belge taramalarında kullanılır.'],
    ['<b>Alt ağ maskelerini koru</b>', '255.255.255.0 gibi değerler IP adresi sayılmaz.'],
    ['<b>Kalan risk anahtar sözcükleri</b>', 'Bu ifade hiçbir şeyin maskelenmediği satırlarda eşleşirse Yapay zekâya sor uyarı gösterir. Boşsa uyarı verilmez.'],
    ['<b>Yapay zekâya sor: varsayılan model, en büyük istek</b>', 'Yapay zekâya sor ekranında önceden seçili model ve gönderilmesine izin verilen en uzun belge (karakter). Daha uzunu, hiçbir şey çıkmadan reddedilir.'],
]); ?>

<?php g_section('ai', 'Yapay zekâ bağlantıları'); ?>
<p>Yapay zekâya sor, OpenAI uyumlu uç noktaları kullanır. Adresi, anahtarı ve modelleriyle bir bağlantı ekleyin; açık bağlantıların modelleri Yapay zekâya sor model listesinde görünür.</p>
<ul>
  <li>Bağlantılar ve anahtarlar <b>sunucuda</b>, <code>data/settings.json</code> içinde saklanır ve yalnızca <b>bu bilgisayardan</b> değiştirilebilir.</li>
  <li>Kaydedildikten sonra anahtar tarayıcıya geri gönderilmez; ipucu olarak yalnızca son dört karakteri gösterilir. Düzenlerken anahtar alanını boş bırakırsanız mevcut anahtar korunur.</li>
  <li>Bir modele yalnızca <b>maskelenmiş</b> metin gönderilir. Göndermeden önce modelin tam olarak ne alacağını görürsünüz.</li>
  <li>Güvenmeden önce adresi ve anahtarı bağlantıdaki <b>Dene</b> ile sınayın.</li>
</ul>
<?php g_shot('ai', 'Maskeli önizleme, modelin tam olarak ne alacağını gösterir.'); ?>

<?php g_section('backup', 'Yedekle / geri yükle'); ?>
<ul>
  <li><b>Dışa aktar</b> tüm kuralları, kategorileri ve ayarları tek bir JSON dosyası olarak indirir.</li>
  <li><b>İçe aktar</b> böyle bir dosyayı okur. Yerleşik kurallar anahtarlarıyla eşleştirilip güncellenir; özel kurallar eklenir. Önce mevcut özel kuralları silebilirsiniz.</li>
  <li><b>Eksik varsayılanları ekle</b>, yeni sürümle gelen yerleşik kuralları ekler. <b>Yerleşikleri sıfırla</b> her yerleşik kuralı ve kategoriyi özgün haline döndürür; kendi kurallarınız korunur.</li>
  <li><b>Değişiklik günlüğü</b> kural, kategori ve ayar değişikliklerini listeler.</li>
</ul>
<?php g_note('Ayarlar tarayıcıda durur. Site verilerini silmeden ya da başka bir tarayıcıya geçmeden önce yedek alın.', 'warn'); ?>

<?php g_section('security', 'Parola ve güvenlik'); ?>
<p>Ayarlar bir <b>yönetici parolasıyla</b> korunur.</p>
<ul>
  <li><b>İlk kullanım</b>: Ayarlar'ı ilk açtığınızda bir parola belirlemeniz istenir (en az 8 karakter). O zamana kadar kimse ayarları kullanamaz.</li>
  <li>O parolayla <b>oturum açarsınız</b>; <b>Oturumu kapat</b> ayarlar menüsünün altındadır. Oturum, <b>Güvenlik</b> bölümünde seçtiğiniz süre sonunda kendiliğinden biter (varsayılan 60 dakika).</li>
  <li><b>Beş hatalı deneme</b> girişi beş dakika kilitler.</li>
  <li><b>Parolayı değiştirmek</b> için Güvenlik'te mevcut parolayı ve yenisini iki kez girin.</li>
  <li>Ayarlar <b>yalnızca bu bilgisayardan</b> açılır; başka bir cihazdan sayfa bunu söyler.</li>
</ul>
<?php g_note('Parola <b>ekranı ve yapay zekâ bağlantılarını</b> (sunucuda tutulan adresler ve anahtarlar) kilitler. Maskeleme kuralları tarayıcıda durduğu için parola o verinin şifrelenmesi değildir.', 'warn'); ?>
<?php g_note('Parolayı unutursanız <code>data/settings.json</code> içindeki <code>admin_hash</code> satırını silin. Ayarlar\'a bir sonraki girişte yeni parola istenir.', 'tip'); ?>

<?php g_section('tips', 'İyi uygulamalar'); ?>
<ul>
  <li>Her seferinde tek şey değiştirin, sonra <b>Deneyin</b> kutusunda gerçek bir örnekle sınayın.</li>
  <li>Adlar için özel sözlüğü, desenler için kural düzenleyiciyi kullanın.</li>
  <li>Kural silmeden önce gürültülü kategorileri tarama eşleştirmede kapatın; geri almak kolaydır.</li>
  <li>Güncel bir dışa aktarım tutun. Özel kurallarınızın tek kopyası odur.</li>
  <li>Tespitler hüküm değil işarettir: gürültüyü azaltmak için kuralları ayarlayın, yine de Exposift'in listelediklerini gözden geçirin.</li>
</ul>

<?php g_close(); ?>
