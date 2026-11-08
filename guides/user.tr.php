<?php // Kullanım kılavuzu – Türkçe içerik (guide.php içinden eklenir)
g_open(
    'Nasıl çalışır',
    'Exposift, bir dosyayı <b>paylaşmadan önce</b> içine bakar: yalnızca sayfada görünene değil, dosyanın gerçekte içerdiklerine. Bulduklarını <b>neden</b> ve <b>kiminle</b> paylaştığınıza göre tartar, kararı size bırakır, dosyayı temizler ve sonucu <b>ayrı bir okuyucuyla yeniden denetler</b>. Dosyanız bu tarayıcıdan hiç çıkmaz.',
    [
        'overview' => 'Dört adım',
        'start'    => 'Taramayı başlatma',
        'findings' => 'Bulguları okuma',
        'inspect'  => 'Nelere bakılır',
        'clean'    => 'Dosyayı temizleme',
        'verify'   => 'Doğrulama',
        'ai'       => 'Açığa çıkarmadan yapay zekâya sorma',
        'settings' => 'Ayarlar ve kurallar',
        'privacy'  => 'Gizlilik',
        'limits'   => 'Exposift ne değildir',
        'faq'      => 'Sık sorulan sorular',
    ]
);
?>

<?php g_section('overview', 'Dört adım'); ?>
<ol>
  <li><b>İncele.</b> Dosya tarayıcınızda açılır ve içeriden incelenir: özellikler, yorumlar, izlenen değişiklikler, gizli metin, ekler, form alanları, önceki sürümler, siyah kutuların altındaki metin ve görünen metin.</li>
  <li><b>Gözden geçir.</b> Her bulgu ne kadar ciddi olabileceğini ve Exposift'in ne kadar emin olduğunu söyler. Neyin gideceğini siz işaretlersiniz: <i>Kaldır</i>, <i>Koru</i> ya da <i>Sonra karar ver</i>. Bu aşamada hiçbir şey değişmez.</li>
  <li><b>Temizle.</b> Onayladığınız bulgular dosyanın yapısından gerçekten çıkarılır, üstü boyanmakla yetinilmez. Kaldırılamayan her şey sessizce atlanmaz, listelenir.</li>
  <li><b>Doğrula.</b> Temizlenen dosya bağımsız bir okuyucuyla yeniden açılır ve kaldırdığınız değerler aranır. Ancak o zaman "Doğrulandı" etiketi alır.</li>
</ol>
<?php g_example(
    "Yazar: Ayşe Yılmaz\nYorum: \"fiyatı Ahmet'e sor\"\nİzlenen silme: \"bütçe 120.000\"\nTelefon: +90 555 000 11 22",
    "Yazar: (kaldırıldı)\nYorum: (kaldırıldı)\nİzlenen silme: (yok)\nTelefon: ████",
    'Olduğu gibi paylaşılırsa', 'Exposift sonrası'
); ?>
<?php g_note('Temizlenen dosya <b>yeni bir dosyadır</b>. Özgün dosyanız asla değiştirilmez.', 'info'); ?>

<?php g_section('start', 'Taramayı başlatma'); ?>
<?php g_shot('home', 'Başlangıç ekranı: dosyayı bırakın, Hızlı Tarama ya da Amaca Dayalı Tarama seçin.'); ?>
<p>İlk ekranda nasıl taranacağını seçer, sonra dosyayı bırakırsınız (ya da tıklayıp seçersiniz).</p>
<h3>Hızlı tarama ya da amaca dayalı tarama</h3>
<ul>
  <li><b>Hızlı tarama</b> neyin olduğunu ve ne kadar ciddi olabileceğini bildirir. Sizin durumunuzu bilmez.</li>
  <li><b>Amaca dayalı tarama</b> belgenin türünü, neden paylaştığınızı ve kimin alacağını sorar (bir iş arkadaşı, dış bir kurum ya da herkes). Aynı telefon numarası iş arkadaşı için sorun değildir, herkese açık sayfada sorulabilir; bulgular buna göre tartılır ve Exposift neyin kaldırılmasını önereceğini bilir.</li>
</ul>
<h3>Aranacak adlar</h3>
<p>Adları (sizin, ailenizin, bir müşterinin) her satıra bir tane yazabilirsiniz. Uzun bir metnin içinde bile geçse bulgu olur. Büyük/küçük harf ve Türkçe harfler önemsenmez (<code>Çağlar</code>, <code>caglar</code>'ı da bulur).</p>
<h3>Desteklenen dosyalar</h3>
<p><b>PDF</b>, <b>Word (.docx)</b>, <b>Excel (.xlsx)</b> ve <b>PowerPoint (.pptx)</b>. Parolalı dosyalar, eski <code>.doc</code>, <code>.xls</code> ve <code>.ppt</code> dosyaları ve diğer biçimler yarım okunmak yerine açık bir iletiyle reddedilir.</p>

<?php g_section('findings', 'Bulguları okuma'); ?>
<?php g_shot('findings', 'Bulgular risk sınıfına göre gruplanır; belge solda görünür.'); ?>
<p>Belge solda, bulgular yerinde işaretli olarak görünür; liste sağdadır. Bir karta tıklayınca ilgili yere gidilir.</p>
<h3>Altı tür açıklık</h3>
<?php g_table([
    ['Sınıf', 'Ne demek', 'Örnekler'],
    ['<b>Gizli Açıklık</b>', 'Dosyada var ama okurken görünmüyor', 'Yorumlar, yazar adları, gizli metin, ekler, katmanlar, IP adresleri'],
    ['<b>Kişisel Veri</b>', 'Bir kişiyle ilgili bilgi', 'Adlar, e-posta, telefon, kimlik numaraları, IBAN, adresler'],
    ['<b>Kimlik Bilgisi Açığı</b>', 'Erişim sağlayan bir şey', 'Parolalar, API anahtarları, anahtarlar'],
    ['<b>Bağlamsal Fazla Paylaşım</b>', 'Kendi başına sorun değil, bu amaç için fazla', 'İç sunucu adları, iş başvurusunda tam adres'],
    ['<b>Geri Getirilebilir Karartma</b>', 'Silinmiş görünüyor ama geri getirilebilir', 'Siyah kutunun altındaki metin, izlenen silmeler, önceki PDF sürümleri'],
    ['<b>Doğrulanamayan İçerik</b>', 'Exposift değerlendiremez', 'Makrolar, özel XML verisi'],
]); ?>
<h3>Önem ve güven</h3>
<p>Her kartın bir önem derecesi (<?= g_tok('Yüksek', '#e11d48') ?> <?= g_tok('Orta', '#d97706') ?> <?= g_tok('Düşük', '#64748b') ?>) ve bir güven düzeyi (<i>Emin</i>, <i>Oldukça emin</i>, <i>Emin değil</i>) vardır. Bir tespit kanıt değil işarettir: kimlik sağlama toplamını geçen bir sayı büyük olasılıkla kimlik numarasıdır, ama yalnızca IP adresine benzeyen bir dize sürüm numarası olabilir. Düşük güvenli bulgular kanıtlarının önüne geçmez.</p>
<h3>Amacınıza göre tutum</h3>
<p>Amaca dayalı taramada her kart, bu alıcı için Exposift'in düşüncesini de söyler:</p>
<ul>
  <li><b>Normalde gerekli</b>: bu tür belgede beklenir.</li>
  <li><b>Gerekli mi, bakın</b>: alıcının buna ihtiyacı olmayabilir.</li>
  <li><b>Nadiren gerekli</b>: tutmadan önce dikkatle bakın.</li>
  <li><b>Kaldırılması önerilir</b>: alıcı için hiçbir işe yaramayan gizli izler.</li>
</ul>
<?php g_note('<b>Önerilenleri kaldırılacak işaretle</b> düğmesi önerilenleri sizin için işaretler. Devam etmeden önce göz atın; karar sizindir.', 'tip'); ?>

<?php g_section('inspect', 'Nelere bakılır'); ?>
<h3>Word (.docx)</h3>
<ul>
  <li>Belge özellikleri (yazar, kurum, tarihler, yazılım, özel özellikler, şablon yolları).</li>
  <li>Yorumlar, izlenen ekleme ve silmeler, gizli metin, beyaz ya da 1 punto metin ve yalnızca <b>siyah vurguyla</b> kapatılmış metin.</li>
  <li>Üst bilgi, alt bilgi, dipnotlar, alan kodları, belge değişkenleri, özel XML.</li>
  <li>Dışarıya giden bağlantılar, gömülü nesne ve dosyalar, önizleme küçük resmi ve resimlerdeki fotoğraf üst verisi (EXIF, GPS).</li>
  <li>Görünen metin: kişisel veri, kimlik bilgisi ve adlarınız için taranır.</li>
</ul>
<h3>PDF</h3>
<ul>
  <li>Bilgi ve XMP üst verisi, açıklamalar ve notlar, ekler, betikler ve eylemler, katmanlar, yer imleri.</li>
  <li>Sayfa alanının dışına konmuş metin ve siyah kutuların altındaki metin (<b>sahte karartma</b>: kutu metnin üstüne yalnızca boyanmıştır).</li>
  <li>Aynı dosyadaki önceki sürümler (artımlı kayıtlar): yeniden açılıp karşılaştırılır.</li>
  <li>Her sayfanın görünen metni.</li>
</ul>
<?php g_note('<b>Resimlerin</b> içine çizilmiş metin (taramalar, ekran görüntüleri) bu sürümde okunmaz. Neyin denetlenmediğini bilesiniz diye <i>analiz edilmedi</i> olarak bildirilir.', 'warn'); ?>

<?php g_section('clean', 'Dosyayı temizleme'); ?>
<?php g_shot('result', 'Temizlemeden sonra dosya yeniden açılıp denetlenir; rapor her kontrolü listeler.'); ?>
<p><b>Devam: temizle ve doğrula</b> düğmesine basın. Exposift önce bir plan gösterir: neler kaldırılacak, bu yöntemle neler kaldırılamıyor ve neden, neleri bilerek bırakıyorsunuz. Sonra <b>Temizlenmiş dosyayı oluştur</b> düğmesine basın.</p>
<h3>Excel (.xlsx)</h3>
<ul>
  <li>Gizli sayfalar, gizli satırlar ve sütunlar: hücreleri dosyada durur ve herkes yeniden gösterebilir.</li>
  <li>Yorumlar (ileti dizisi yorumları da), tanımlı adlar, dış çalışma kitabı bağlantıları, pivot tablo önbellekleri ve kaydedildiği klasör yolu.</li>
  <li>Belge özellikleri, gömülü nesneler, makrolar, küçük resim ve fotoğraf üst verisi; ayrıca her hücre değeri kişisel veri ve kimlik bilgisi için taranır.</li>
</ul>
<h3>PowerPoint (.pptx)</h3>
<ul>
  <li>Konuşmacı notları, yorumlar ve yazarları.</li>
  <li>Gizli slaytlar, gizli şekiller ve slayt dışına konmuş metin.</li>
  <li>Belge özellikleri, gömülü nesneler, dış başvurular, küçük resim ve fotoğraf üst verisi; ayrıca tüm slayt metni kişisel veri için taranır.</li>
</ul>
<h3>Word dosyaları</h3>
<p>Word, Excel ve PowerPoint için paketin parçaları doğrudan düzenlenir (çalışma kitabında gizli sayfa, formüller bozulmasın diye silinmez, boşaltılır; pivot tablo önbellekleri henüz kaldırılamaz): yorumlar kaldırılır, izlenen değişiklikler kabul edilir, gizli ve beyaz parçalar silinir, özellikler temizlenir, gömülü dosyalar ve küçük resim silinir, bağlantılar etkisizleştirilir. Seçilen bir değer, Word onu birkaç parçaya bölmüş olsa bile bir blokla (<code>████</code>) değiştirilir.</p>
<h3>PDF dosyaları: üç yöntem (sizin için seçilir)</h3>
<ul>
  <li><b>Yapıyı temizle</b> dosyayı üst veri, not, ek, betik, yer imi ve önceki sürümler olmadan yeniden yazar. Sayfa metni aranabilir kalır. Sayfanın kendisinin parçası olan metni <b>kaldıramaz</b>.</li>
  <li><b>Metni karart</b>, sayfanın kendisinde olan değerleri seçtiğinizde kullanılır. Bu değerlerin karakterleri sayfanın içinden çıkarılır (yalnızca gizlenmez), yerine siyah kutu çizilir ve sayfanın geri kalanı olduğu gibi kalır: metin arama ve kopyalama çalışmaya devam eder. Sonuç yeniden açılıp taranır; bir değer hâlâ bulunursa (örneğin alışılmadık bir yazı tipi) Exposift kendiliğinden sonraki yönteme geçer. OCR ile bulunan veya konumu bilinmeyen metin bu yolla kararmaz.</li>
  <li><b>Düzleştir ve yeniden oluştur</b> seçilen değerleri siyah kutuyla kapatır, sonra her sayfayı resim olarak çizip PDF'yi yeniden kurar. Gizli olan her şey gider, ama metin arama, kopyalama, erişilebilirlik, formlar ve imzalar kaybolur.</li>
</ul>
<?php g_note('Seçtiğiniz yöntemle bir şey kaldırılamıyorsa nedeniyle birlikte <b>kaldırılmadı</b> olarak listelenir. Sessizce atlanmaz.', 'info'); ?>

<?php g_section('verify', 'Doğrulama'); ?>
<p>Sonuç, onu üreten okuyucudan farklı bir okuyucuyla açılır ve yeniden aranır:</p>
<ul>
  <li>Dosya geçerli bir belge olarak açılır; ilişkiler ve XML sağlamdır (Word) ya da sayfa sayısı değişmemiştir (PDF).</li>
  <li>Kaldırılan değerler hiçbir yerde bulunmaz: ham baytlar, çözülmüş metin, etiketsiz metin, iç içe arşivler, çıkarılan PDF metni, üst veri, notlar, ekler, ham akışlar.</li>
  <li>Yeni bir inceleme, seçilen gizli içerik türlerinden hiçbirini bulmaz.</li>
  <li>Düzleştirmeden sonra: kapatılan alanlar çıktıda tamamen siyahtır.</li>
</ul>
<?php g_table([
    ['Sonuç', 'Anlamı'],
    ['<b>Doğrulandı</b>', 'Tüm denetimler geçti.'],
    ['<b>Kısmen doğrulandı</b>', 'Geçti, ama bazı şeyler denetlenemedi ya da tercihinizle bırakıldı.'],
    ['<b>Başarısız</b>', 'Kaldırılan bir değer ya da içerik hâlâ bulundu. Dosyayı paylaşmayın; rapor nerede olduğunu söyler.'],
]); ?>
<p><b>Gizlilik Makbuzu</b>, yapılanları ve denetlenenleri, ayrıca girdi ve çıktının özetlerini (hash) içeren bir JSON dosyasıdır. Hassas değerlerin kendisini asla içermez.</p>

<?php g_section('ai', 'Açığa çıkarmadan yapay zekâya sorma'); ?>
<?php g_shot('ai', 'Maskeli önizleme, modelin tam olarak ne alacağını gösterir.'); ?>
<p>Bulgular ekranındaki <b>Yapay zekâya sor (maskeli)</b> düğmesi, belgeyi elinizden çıkarmadan hakkında soru sormanızı sağlar.</p>
<ol>
  <li><b>Maskele.</b> Yalnızca <i>görünen</i> metin kullanılır. Tarayıcınız adları, numaraları, adresleri ve sırları <?= g_tok('<PERSON_1>', '#db2777') ?> <?= g_tok('<EMAIL_1>', '#0d9488') ?> <?= g_tok('<IBAN_1>', '#2563eb') ?> gibi etiketlerle değiştirir.</li>
  <li><b>Önizle.</b> Modelin tam olarak ne alacağını görürsünüz. Hâlâ hassas görünen bir şey varsa, siz de maskeleyene ya da kontrol ettiğinizi onaylayana kadar gönderme engellenir.</li>
  <li><b>Gönder.</b> Yalnızca maskeli metin seçtiğiniz modele gider.</li>
  <li><b>Geri çevir.</b> Yanıt etiketlerle gelir; gerçek değerleri tarayıcınız geri koyar. Modelin uydurduğu etiketler işaretlenir ve olduğu gibi bırakılır.</li>
</ol>
<?php g_example(
    "Soru: kime ulaşmalıyım?\n\nAyşe Yılmaz'a ayse@acme.com adresinden ulaşın, IBAN TR33 0006 1005 1978 6457 8413 26.",
    "Soru: kime ulaşmalıyım?\n\n<PERSON_1>'a <USER_1>@acme.com adresinden ulaşın, IBAN <IBAN_1>.",
    'Belgeniz', 'Modelin aldığı'
); ?>
<?php g_note('Gizli içerik, yorumlar ve üst veri <b>asla</b> gönderilmez. Her istek Gizlilik Makbuzu\'na (model, boyutlar, kategoriler) içerik olmadan kaydedilir.', 'info'); ?>

<h3>Dosyayı yapay zekâ ile yeniden yazma</h3>
<p>Aynı pencerede <b>Soru sor</b> yerine <b>Dosyayı yeniden yaz</b>'ı seçerek Word, Excel ve PowerPoint dosyalarında yazım düzeltme, resmî dil, çeviri gibi işler yaptırabilirsiniz. Aynı maskeleme kullanılır; model yalnızca etiketleri görür. Önerilen değişiklikler listelenir (eski metin üstü çizili, yeni metin altında); uygulayacaklarınızı seçip yeniden yazılan dosyayı indirirsiniz.</p>
<ul>
  <li>Yalnızca düz paragraflar ve metin hücreleri yeniden yazılabilir. Gizli içerik, yorumlar, formüller, alanlar ve sekme veya satır sonu içeren metinlere dokunulmaz.</li>
  <li>Dosyanın geri kalanına, resimlerine, tablolarına ve düzenine dokunulmaz. Değişen bir paragrafta ilk parçanın biçimi tüm paragrafa uygulanır.</li>
  <li>Model bir etiketi atlarsa veya uydurursa o değişiklik işaretlenir ve varsayılan olarak seçili gelmez.</li>
  <li>Yeniden yazılan dosya, geçerli kalıp kalmadığını görmek için yeniden açılıp denetlenir. Bu özellik benzetilmiş bir modelle denendi; paylaşmadan önce sonucu Word, Excel veya PowerPoint'te kontrol edin. PDF dosyaları yeniden yazılamaz.</li>
</ul>

<?php g_section('settings', 'Ayarlar ve kurallar'); ?>
<?php g_shot('scan', 'Tarama eşleştirme: her kural kategorisinin belge taramasında neye dönüşeceğini seçin.'); ?>
<p>Sağ üstteki çark simgesi ayarları açar.</p>
<ul>
  <li><b>Kurallar</b>: her maskeleme kuralı düzenlenebilir, çoğaltılabilir, kapatılabilir ya da sıfırlanabilir; kendi kuralınızı (regex, anahtar = değer ya da sözlük) ekleyip canlı sınayabilirsiniz.</li>
  <li><b>Kategoriler ve etiketler</b>, <b>Listeler ve istisnalar</b>, <b>Genel ayarlar</b>: etiket biçimi, asla maskelenmeyecek değerler, alan adları, ad olmayan sözcükler ve daha fazlası.</li>
  <li><b>Tarama eşleştirme</b>: belge taranırken her kuralın eşleşmesinin neye dönüşeceğini belirler. Bir kategori (ya da tek bir kural) bir <i>tarama türüne</i> eşlenir; tarama türü risk sınıfını, önem derecesini ve amaç ile alıcıya göre nasıl tartılacağını belirler. Exposift'in kendi denetimleri (sağlama toplamlı kimlikler, IBAN, kartlar, IP'ler, sırlar) önce çalışır ve çakışmada kazanır; kurallar parolaları, adları, sunucuları ve kendi desenlerinizi ekler.</li>
  <li><b>Alan etiketleri</b>: bir değerin yanındaki etiket ("Ad Soyad", "Posta adresi", "API token"), aynı satırda ya da bir sonraki tablo hücresindeki değeri ilgili tarama türüne çevirir. Liste size aittir.</li>
  <li><b>Yapay zekâ bağlantıları</b>: "Yapay zekâya sor"un kullandığı uç noktaları ve anahtarları ekleyin. Kayıtlı anahtarın yalnızca son dört karakteri gösterilir.</li>
  <li><b>Yedekle / geri yükle</b>: tüm kuralları, kategorileri, listeleri ve eşleştirmeyi dışa ve içe aktarın. Yönetici parolası hiçbir dışa aktarmaya dahil edilmez.</li>
  <li><b>Güvenlik</b>: ayarlar, ilk kullanımda seçtiğiniz bir parolayla korunur; buradan değiştirebilirsiniz. Kurulum ve erişimi geri alma <a href="admin-guide.php">Yönetici kılavuzunda</a> anlatılır.</li>
</ul>
<?php g_note('Kurallar, kategoriler ve listeler <b>bu tarayıcıda</b> saklanır; taşımak için Yedek\'i kullanın. Yapay zekâ bağlantıları bu bilgisayarda saklanır ve yalnızca bu bilgisayardan değiştirilebilir.', 'tip'); ?>

<?php g_section('privacy', 'Gizlilik'); ?>
<ul>
  <li>Dosyalar <b>tarayıcınızın içinde</b> açılır, çözümlenir, temizlenir ve doğrulanır. Yüklenmez, saklanmaz.</li>
  <li>Sayfa yalnızca kendi sunucusuyla konuşabilir (bir içerik güvenliği ilkesi bunu zorlar). Yalnızca "Yapay zekâya sor" bir şey gönderir, o da yalnızca maskeli metni.</li>
  <li>Raporlar ve makbuzlar sayıları, türleri, özetleri ve denetimleri içerir, değerleri asla.</li>
  <li>Hiçbir şey toplanmaz: hesap yok, istatistik yok.</li>
</ul>

<?php g_section('limits', 'Exposift ne değildir'); ?>
<ul>
  <li>Bir virüs önleyici ya da tam bir veri sızıntısı önleme sistemi değildir.</li>
  <li>Hukuki tavsiye vermez. "Gerekli mi, bakın" bir sorudur, hüküm değil.</li>
  <li>Resimlerin içindeki metin yalnızca siz isteyince okunur: <b>Resimlerdeki metni oku (OCR)</b> düğmesi, taranmış PDF sayfalarında ve Word, Excel, PowerPoint dosyalarındaki resimlerde tarayıcınızda Tesseract çalıştırır (İngilizce ve Türkçe). OCR yanılabilir; sonucu bir ipucu sayın. PDF’te bu yolla bulunan değerler, sayfalar resme çevrilirken kapatılabilir; Office dosyalarında resmin kendisini değiştirmek ya da silmek gerekir.</li>
  <li>Bir dosyanın güvenli olduğunu asla vaat etmez. Amaç, dosyanın ele verdiklerini azaltmaktır; göndermeden önce sonuca bakın.</li>
</ul>

<?php g_section('faq', 'Sık sorulan sorular'); ?>
<h3>Özgün dosyam değişir mi?</h3>
<p>Hayır. Ayrı bir temizlenmiş dosya indirirsiniz.</p>
<h3>Bir bulgu neden "Emin değil" diye işaretli?</h3>
<p>Kanıt zayıf olduğu için; örneğin yalnızca IP adresine benzeyen bir sayı. Kendiniz kontrol edin; karar sizindir.</p>
<h3>"Yapıyı temizle" sayfadaki bir telefon numarasını neden kaldıramıyor?</h3>
<p>O yöntem sayfa içeriğini olduğu gibi korur. Sayfaya çizilmiş değerleri kapatmak için <b>Düzleştir ve yeniden oluştur</b>'u seçin.</p>
<h3>Sonuç "Kısmen doğrulandı" diyor. Paylaşabilir miyim?</h3>
<p>Raporu okuyun: neyin denetlenemediğini ya da neyi bilerek bıraktığınızı söyler. Bunlar bu alıcı için kabul edilebilirse evet.</p>
<h3>"Yapay zekâya sor" belgemi saklar mı?</h3>
<p>Exposift hiçbir şey saklamaz. Model sağlayıcısı yalnızca önizlediğiniz maskeli metni alır; onu nasıl kullandığı için kendi koşullarına bakın.</p>
<?php g_close(); ?>
